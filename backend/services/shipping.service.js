import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Shipping from "../models/shipping.model.js";
import ShippingQuote from "../models/shippingQuote.model.js";
import melhorenvioService from "./melhorenvio.service.js";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";
import { createHttpError } from "../helpers/httpError.js";
import { orderStatuses } from "../constants/orderStatuses.js";
import { shippingStatuses } from "../constants/shippingStatuses.js";
import { subOrderStatuses } from "../constants/subOrderStatuses.js";

/**
 * Serviço de Orquestração de Shipping
 * Coordena:
 * - Cálculo de fretes (cotação)
 * - Seleção de transportadora
 * - Geração de etiquetas
 * - Sincronização de status com webhooks
 */

class ShippingService {
  ensureSellerOwnsStoreOrThrow(store, ownerId) {
    if (!ownerId) return;

    const storeOwnerId = String(store?.owner?._id ?? store?.owner ?? "").trim();
    const requesterOwnerId = String(ownerId ?? "").trim();

    if (!storeOwnerId || !requesterOwnerId || storeOwnerId !== requesterOwnerId) {
      throw createHttpError("Acesso proibido ao subpedido informado", 403, undefined, "SHIPPING_FORBIDDEN");
    }
  }

  roundCurrency(value) {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round((numeric + Number.EPSILON) * 100) / 100;
  }

  formatCurrencyForProvider(value) {
    return this.roundCurrency(value).toFixed(2);
  }

  normalizeBrazilianDocument(value) {
    return String(value ?? "")
      .replace(/\D/g, "")
      .trim();
  }

  isValidCpf(value) {
    const cpf = this.normalizeBrazilianDocument(value);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const calcDigit = (base, factor) => {
      let total = 0;
      for (const digit of base) {
        total += Number(digit) * factor;
        factor -= 1;
      }
      const mod = (total * 10) % 11;
      return mod === 10 ? 0 : mod;
    };

    const d1 = calcDigit(cpf.slice(0, 9), 10);
    const d2 = calcDigit(cpf.slice(0, 10), 11);
    return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
  }

  resolvePartyDocument({ document, fieldLabel, errorCode, orderId, subOrderId, sandboxFallback }) {
    const normalized = this.normalizeBrazilianDocument(document);
    if (normalized.length === 14) {
      return {
        document: normalized,
        documentType: "CNPJ",
        fallbackUsed: false,
      };
    }

    if (normalized.length === 11 && this.isValidCpf(normalized)) {
      return {
        document: normalized,
        documentType: "CPF",
        fallbackUsed: false,
      };
    }

    if (String(MELHOR_ENVIO_CONFIG.environment).toLowerCase() === "sandbox") {
      const fallbackDocument = this.normalizeBrazilianDocument(sandboxFallback?.document);
      const fallbackDocumentType = String(sandboxFallback?.documentType ?? "CPF").toUpperCase();

      if (
        (fallbackDocumentType === "CPF" && fallbackDocument.length !== 11) ||
        (fallbackDocumentType === "CNPJ" && fallbackDocument.length !== 14)
      ) {
        throw createHttpError(
          `Fallback de documento inválido para ${fieldLabel}`,
          500,
          { fieldLabel, fallbackDocument, fallbackDocumentType },
          "SHIPPING_SANDBOX_FALLBACK_DOCUMENT_INVALID",
        );
      }

      if (fallbackDocumentType === "CPF" && !this.isValidCpf(fallbackDocument)) {
        throw createHttpError(
          `Fallback de CPF inválido para ${fieldLabel}`,
          500,
          { fieldLabel, fallbackDocument },
          "SHIPPING_SANDBOX_FALLBACK_CPF_INVALID",
        );
      }

      return {
        // Documento fictício válido para ambiente de testes.
        document: fallbackDocument,
        documentType: fallbackDocumentType,
        fallbackUsed: true,
      };
    }

    throw createHttpError(
      `${fieldLabel} é obrigatório para gerar etiqueta no MelhorEnvio`,
      400,
      {
        orderId,
        subOrderId,
      },
      errorCode,
    );
  }

  resolveFreightPolicy(subOrder) {
    const coupon = subOrder?.coupon ?? null;
    const code = String(coupon?.code ?? "").toUpperCase();

    const explicitFreeShippingFlag =
      coupon?.freeShipping === true ||
      coupon?.isFreeShipping === true ||
      coupon?.benefitType === "free_shipping" ||
      coupon?.type === "free_shipping";

    const freeShippingCodePattern = /(FRETE\s*GRATIS|FRETEGRATIS|FREE\s*SHIPPING|SHIPFREE)/i;
    const isFreeShippingByCode = freeShippingCodePattern.test(code);

    const freeShipping = Boolean(coupon?.scope === "platform" && (explicitFreeShippingFlag || isFreeShippingByCode));

    return {
      // Regra de negócio: cliente paga frete por padrão.
      // Exceção: frete grátis por promoção/cupom da plataforma.
      whoPays: freeShipping ? "platform_paid" : "customer_pays",
      freeShipping,
    };
  }

  /**
   * Obtém opções de frete para um subOrder
   * Chama MelhorEnvio API sempre para ter cotação fresca
   */
  async getShippingOptions(subOrderId, forceRecalculate = false, ownerId) {
    const subOrder = await SubOrder.findById(subOrderId)
      .populate("order")
      .populate({ path: "store", populate: [{ path: "address" }, { path: "owner", select: "_id" }] })
      .populate("items.productVariantId");

    if (!subOrder) {
      throw createHttpError("SubOrder não encontrada", 404, undefined, "SUBORDER_NOT_FOUND");
    }

    const order = subOrder.order;
    if (!order.shippingAddress) {
      throw createHttpError(
        "Endereço de entrega não configurado no pedido",
        400,
        undefined,
        "SHIPPING_ADDRESS_REQUIRED",
      );
    }

    const store = subOrder.store;
    this.ensureSellerOwnsStoreOrThrow(store, ownerId);

    if (!store.address) {
      throw createHttpError("Endereço da loja não configurado", 400, undefined, "STORE_ADDRESS_REQUIRED");
    }

    // Buscar cotação existente (válida por 7 dias, não expirada)
    if (!forceRecalculate) {
      const existingQuote = await ShippingQuote.findOne({
        subOrder: subOrderId,
        expiresAt: { $gt: new Date() },
        convertedToLabel: false,
      });

      if (existingQuote) {
        return {
          carriers: existingQuote.carriers,
          packages: existingQuote.packages,
          whoPays: existingQuote.whoPays,
          freeShipping: existingQuote.freeShipping,
          quoteId: existingQuote._id,
          cachedAt: existingQuote.createdAt,
        };
      }
    }

    // Montar payload para MelhorEnvio
    const payload = {
      from: {
        postal_code: store.address.zipCode.replace("-", ""),
        address: store.address.street,
        number: store.address.number,
        complement: store.address.complement || "",
        district: store.address.neighborhood,
        city: store.address.city,
        state: store.address.state,
      },
      to: {
        postal_code: order.shippingAddress.zipCode.replace("-", ""),
        address: order.shippingAddress.street,
        number: order.shippingAddress.number,
        complement: order.shippingAddress.complement || "",
        district: order.shippingAddress.neighborhood,
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
      },
      // Se tiver dimensões, usar; senão ME calcula
      products: subOrder.items.map((item) => ({
        id: item.productVariantId.toString(),
        width: item.productVariantId.width || 10,
        height: item.productVariantId.height || 10,
        length: item.productVariantId.length || 10,
        weight: item.productVariantId.weight || 0.5,
        quantity: item.quantity,
        insurance_value: item.price * item.quantity,
      })),
    };

    // Chamar API MelhorEnvio
    const result = await melhorenvioService.calculateShipping(store._id, payload);

    const { whoPays, freeShipping } = this.resolveFreightPolicy(subOrder);

    // Salvar cotação
    const quote = new ShippingQuote({
      order: order._id,
      subOrder: subOrderId,
      store: store._id,
      quotaData: result,
      carriers: (Array.isArray(result.carriers) ? result.carriers : []).map((c) => ({
        id: c.id,
        name: c.name,
        price: Number(c.price ?? 0),
        customPrice: Number(c.custom_price ?? c.price ?? 0),
        deliveryTime: Number(c.delivery_time ?? 0),
        customDeliveryTime: Number(c.custom_delivery_time ?? c.delivery_time ?? 0),
      })),
      packages: result.packages || [],
      whoPays,
      freeShipping,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
    });

    await quote.save();

    return {
      carriers: quote.carriers,
      packages: quote.packages,
      whoPays: quote.whoPays,
      freeShipping: quote.freeShipping,
      quoteId: quote._id,
    };
  }

  /**
   * Seleciona transportadora e cria ShippingLabel
   */
  async selectShippingOption(subOrderId, carrierId, quoteId, ownerId) {
    const subOrder = await SubOrder.findById(subOrderId)
      .populate("order")
      .populate({ path: "store", populate: { path: "owner", select: "_id" } });

    if (!subOrder) {
      throw createHttpError("SubOrder não encontrada", 404, undefined, "SUBORDER_NOT_FOUND");
    }

    this.ensureSellerOwnsStoreOrThrow(subOrder.store, ownerId);

    if (subOrder.shipping) {
      throw createHttpError(
        "Frete já configurado para este subpedido",
        409,
        undefined,
        "SUBORDER_SHIPPING_ALREADY_SET",
      );
    }

    const quote = await ShippingQuote.findById(quoteId);
    if (!quote) {
      throw createHttpError("Cotação de frete não encontrada", 404, undefined, "QUOTE_NOT_FOUND");
    }

    if (quote.subOrder.toString() !== subOrderId.toString()) {
      throw createHttpError("Cotação de frete inválida para este pedido", 400, undefined, "QUOTE_SUBORDER_MISMATCH");
    }

    if (quote.expiresAt <= new Date()) {
      throw createHttpError("Cotação de frete expirada", 400, undefined, "QUOTE_EXPIRED");
    }

    if (quote.convertedToLabel) {
      throw createHttpError(
        "Esta cotação já foi utilizada para gerar frete",
        409,
        undefined,
        "QUOTE_ALREADY_CONVERTED",
      );
    }

    // Validar que carrier é válido
    const selectedCarrier = quote.carriers.find((c) => String(c.id) === String(carrierId));
    if (!selectedCarrier) {
      throw createHttpError("Transportadora selecionada não é válida", 400, undefined, "INVALID_CARRIER");
    }

    // Atualizar quote com seleção
    quote.selectedCarrier = selectedCarrier;
    await quote.save();

    // Criar registro de Shipping (ainda pending, sem etiqueta no ME)
    const shipping = new Shipping({
      store: subOrder.store._id,
      subOrder: subOrderId,
      carrier: this.mapCarrierName(selectedCarrier.name),
      shippingServiceInfo: {
        meServiceId: Number(selectedCarrier.id),
        meCarrierName: selectedCarrier.name,
      },
      whoPays: quote.whoPays,
      shippingCost: quote.freeShipping ? 0 : selectedCarrier.price,
      estimatedDeliveryDate: this.calculateDeliveryDate(selectedCarrier.deliveryTime),
      status: shippingStatuses.PENDING,
    });

    await shipping.save();

    // Atualizar SubOrder com referência à shipping
    subOrder.shipping = shipping._id;
    subOrder.shippingCost = shipping.shippingCost;
    await subOrder.save();

    return {
      shippingId: shipping._id,
      carrier: shipping.carrier,
      cost: shipping.shippingCost,
      estimatedDeliveryDate: shipping.estimatedDeliveryDate,
    };
  }

  /**
   * Gera etiqueta no MelhorEnvio
   * Transforma shipping de "pending" para "posted" (se sucesso)
   */
  async generateLabel(subOrderId, ownerId) {
    const subOrder = await SubOrder.findById(subOrderId)
      .populate({ path: "order", populate: { path: "user", select: "email cpf" } })
      .populate({
        path: "store",
        populate: [{ path: "address" }, { path: "owner", select: "_id email" }],
      })
      .populate("shipping");

    if (!subOrder) {
      throw createHttpError("SubOrder não encontrada", 404, undefined, "SUBORDER_NOT_FOUND");
    }

    this.ensureSellerOwnsStoreOrThrow(subOrder.store, ownerId);

    if (!subOrder.shipping) {
      throw createHttpError("Frete não foi configurado para este subOrder", 400, undefined, "SHIPPING_NOT_CONFIGURED");
    }

    const shipping = subOrder.shipping;
    const order = subOrder.order;
    const store = subOrder.store;
    const isSandbox = String(MELHOR_ENVIO_CONFIG.environment).toLowerCase() === "sandbox";
    const selectedQuote = await ShippingQuote.findOne({ subOrder: subOrderId }).select("selectedCarrier").lean();
    const selectedCarrierSnapshot = shipping?.shippingServiceInfo?.selectedCarrier ?? selectedQuote?.selectedCarrier;

    const serviceIdFromShipping = Number(shipping?.shippingServiceInfo?.meServiceId);
    const serviceIdFromSnapshot = Number(selectedCarrierSnapshot?.id);
    const serviceIdFromQuote = Number(selectedQuote?.selectedCarrier?.id);
    const fallbackServiceId = this.getServiceId(shipping.carrier);
    const resolvedServiceId =
      Number.isFinite(serviceIdFromShipping) && serviceIdFromShipping > 0
        ? serviceIdFromShipping
        : Number.isFinite(serviceIdFromSnapshot) && serviceIdFromSnapshot > 0
          ? serviceIdFromSnapshot
          : Number.isFinite(serviceIdFromQuote) && serviceIdFromQuote > 0
            ? serviceIdFromQuote
            : fallbackServiceId;
    const senderDocument = this.resolvePartyDocument({
      document: store.cnpj,
      fieldLabel: "CNPJ/CPF do remetente",
      errorCode: "SHIPPING_SENDER_DOCUMENT_REQUIRED",
      orderId: order._id,
      subOrderId: subOrder._id,
      sandboxFallback: {
        // CPF fictício para sandbox.
        document: "52998224725",
        documentType: "CPF",
      },
    });
    const recipientDocument = this.resolvePartyDocument({
      document: order.user?.cpf,
      fieldLabel: "CNPJ/CPF do destinatário",
      errorCode: "SHIPPING_RECIPIENT_DOCUMENT_REQUIRED",
      orderId: order._id,
      subOrderId: subOrder._id,
      sandboxFallback: {
        // CPF fictício para sandbox.
        document: "39053344705",
        documentType: "CPF",
      },
    });

    if (isSandbox && senderDocument.documentType !== "CPF") {
      senderDocument.document = "52998224725";
      senderDocument.documentType = "CPF";
      senderDocument.fallbackUsed = true;
    }

    if (senderDocument.document === recipientDocument.document) {
      if (isSandbox) {
        recipientDocument.document = "39053344705";
        recipientDocument.documentType = "CPF";
      } else {
        throw createHttpError(
          "CPF/CNPJ do remetente e do destinatário não podem ser iguais",
          400,
          { orderId: order._id, subOrderId: subOrder._id },
          "SHIPPING_SENDER_RECIPIENT_DOCUMENT_EQUAL",
        );
      }
    }

    // Validar status do Order (precisa estar paid)
    if (order.status !== orderStatuses.PAID) {
      throw createHttpError(
        `Pedido deve estar pago antes de gerar etiqueta. Status atual: ${order.status}`,
        409,
        { status: order.status },
        "ORDER_NOT_PAID",
      );
    }

    // Validar endereços
    if (!order.shippingAddress || !store.address) {
      throw createHttpError("Endereços de origem ou destino não configurados", 400, undefined, "ADDRESSES_REQUIRED");
    }

    const productsForLabel = (subOrder.items ?? []).map((item) => ({
      name: item.name,
      quantity: Number(item.quantity ?? 0),
      unitary_value: this.formatCurrencyForProvider(item.price),
    }));
    const productsDeclaredTotal = this.roundCurrency(
      productsForLabel.reduce((sum, item) => sum + Number(item.unitary_value ?? 0) * Number(item.quantity ?? 0), 0),
    );

    // Montar payload para criar etiqueta
    const insuredValue = this.roundCurrency(Math.max(1, productsDeclaredTotal));

    const payload = {
      service: resolvedServiceId,
      from: {
        name: store.name,
        phone: store.address.phoneNumber || "0000000000",
        email: store.owner?.email || null,
        document: senderDocument.document,
        state_register: "",
        document_type: senderDocument.documentType,
        postal_code: store.address.zipCode.replace("-", ""),
        address: store.address.street,
        number: store.address.number,
        complement: store.address.complement || "",
        district: store.address.neighborhood,
        city: store.address.city,
        state: store.address.state,
      },
      to: {
        name: order.shippingAddress.receiverName,
        phone: order.shippingAddress.phoneNumber,
        email: order.user?.email || null,
        document: recipientDocument.document,
        document_type: recipientDocument.documentType,
        postal_code: order.shippingAddress.zipCode.replace("-", ""),
        address: order.shippingAddress.street,
        number: order.shippingAddress.number,
        complement: order.shippingAddress.complement || "",
        district: order.shippingAddress.neighborhood,
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
      },
      products: productsForLabel,
      volumes: shipping.dimensions?.weight
        ? [
            {
              public_weight: Math.round(shipping.dimensions.weight),
              dimensions: {
                width: shipping.dimensions.width,
                height: shipping.dimensions.height,
                length: shipping.dimensions.length,
              },
              format: "box",
            },
          ]
        : undefined,
      options: {
        receipt: true,
        own_hand: false,
        insurance_value: this.formatCurrencyForProvider(insuredValue),
      },
      value: this.formatCurrencyForProvider(insuredValue),
      insurance_value: this.formatCurrencyForProvider(insuredValue),
      reference: `ORDER_${order._id}`,
    };

    let labelResult = null;
    try {
      labelResult = await melhorenvioService.createShippingLabel(store._id, payload);
      shipping.shippingServiceInfo = {
        ...(shipping.shippingServiceInfo ?? {}),
        meServiceId: resolvedServiceId,
      };
    } catch (error) {
      const providerError = error?.details?.error;
      const providerMessage = String(
        typeof providerError === "string" ? providerError : (providerError?.message ?? error?.message ?? ""),
      ).toLowerCase();

      const declaredValueDiagnostics = {
        value: payload.value,
        insurance_value: payload.insurance_value,
        options_insurance_value: payload.options?.insurance_value,
        productsDeclaredTotal,
      };

      if (providerMessage.includes("transportadora") && providerMessage.includes("nao atende")) {
        throw createHttpError(
          "A transportadora escolhida no checkout não atende mais este trecho para emissão da etiqueta. Refaça o checkout para nova seleção de frete.",
          409,
          {
            orderId: order._id,
            subOrderId: subOrder._id,
            selectedServiceId: resolvedServiceId,
            selectedCarrier: selectedCarrierSnapshot ?? null,
            providerError: error?.details,
            declaredValueDiagnostics,
          },
          "CHECKOUT_SELECTED_CARRIER_UNAVAILABLE",
        );
      }

      if (error?.code === "ME_CREATE_LABEL_FAILED") {
        throw createHttpError(
          error.message,
          error.statusCode ?? 502,
          {
            ...(typeof error?.details === "object" && error?.details !== null
              ? error.details
              : { error: error?.details }),
            declaredValueDiagnostics,
          },
          error.code,
        );
      }

      throw error;
    }

    // Atualizar Shipping com dados do ME
    shipping.melhorEnvioOrderId = labelResult.id;
    shipping.status = shippingStatuses.POSTED;
    shipping.trackingCode = labelResult.tracking;
    shipping.labelUrl = labelResult.labelUrl;
    shipping.history.push({
      timestamp: new Date(),
      status: shippingStatuses.POSTED,
      description: "Etiqueta criada e postada no MelhorEnvio",
      melhorEnvioStatus: labelResult.status,
    });

    await shipping.save();

    // Atualizar ShippingQuote como convertido
    const quote = await ShippingQuote.findOne({ subOrder: subOrderId });
    if (quote) {
      quote.convertedToLabel = true;
      quote.shippingLabel = shipping._id;
      await quote.save();
    }

    return {
      shippingId: shipping._id,
      melhorEnvioId: labelResult.id,
      tracking: labelResult.tracking,
      labelUrl: labelResult.labelUrl,
      status: shipping.status,
    };
  }

  /**
   * Retorna a URL da etiqueta já gerada para um subOrder.
   * Se o labelUrl não estiver salvo localmente, tenta recuperar do MelhorEnvio.
   */
  async getLabelUrl(subOrderId, ownerId) {
    const subOrder = await SubOrder.findById(subOrderId).populate({
      path: "store",
      populate: { path: "owner", select: "_id" },
    });

    if (!subOrder) {
      throw createHttpError("SubOrder não encontrada", 404, undefined, "SUBORDER_NOT_FOUND");
    }

    this.ensureSellerOwnsStoreOrThrow(subOrder.store, ownerId);

    const shipping = await Shipping.findOne({ subOrder: subOrderId }).select(
      "_id subOrder store melhorEnvioOrderId labelUrl trackingCode status updatedAt",
    );

    if (!shipping) {
      throw createHttpError("Shipping não encontrado para este subOrder", 404, undefined, "SHIPPING_NOT_FOUND");
    }

    if (shipping.labelUrl) {
      return {
        shippingId: shipping._id,
        subOrderId: shipping.subOrder,
        labelUrl: shipping.labelUrl,
        trackingCode: shipping.trackingCode,
        melhorEnvioId: shipping.melhorEnvioOrderId,
        status: shipping.status,
        updatedAt: shipping.updatedAt,
        source: "local",
      };
    }

    if (!shipping.melhorEnvioOrderId) {
      throw createHttpError(
        "Etiqueta ainda não foi gerada para este envio",
        404,
        { subOrderId },
        "SHIPPING_LABEL_NOT_GENERATED",
      );
    }

    const providerData = await melhorenvioService.getPrintLabel(shipping.store, shipping.melhorEnvioOrderId, "url");

    const providerLabelUrl =
      typeof providerData === "string"
        ? providerData
        : providerData?.url || providerData?.label || providerData?.link || null;

    if (!providerLabelUrl) {
      throw createHttpError(
        "MelhorEnvio não retornou URL de impressão da etiqueta",
        502,
        { subOrderId, melhorEnvioId: shipping.melhorEnvioOrderId, providerData },
        "ME_LABEL_URL_NOT_FOUND",
      );
    }

    shipping.labelUrl = providerLabelUrl;
    await shipping.save();

    return {
      shippingId: shipping._id,
      subOrderId: shipping.subOrder,
      labelUrl: providerLabelUrl,
      trackingCode: shipping.trackingCode,
      melhorEnvioId: shipping.melhorEnvioOrderId,
      status: shipping.status,
      updatedAt: shipping.updatedAt,
      source: "provider",
    };
  }

  /**
   * Atualiza status de shipping via webhook ou polling
   */
  async updateLabelStatus(melhorEnvioId, melhorEnvioStatus) {
    const shipping = await Shipping.findOne({
      melhorEnvioOrderId: melhorEnvioId,
    });

    if (!shipping) {
      console.warn(`[Shipping] etiqueta não encontrada para melhorEnvioOrderId=${melhorEnvioId}`);
      return null;
    }

    // Mapear status ME → nosso status
    const newStatus = MELHOR_ENVIO_CONFIG.statusMap[melhorEnvioStatus] || melhorEnvioStatus;

    // Se já tem esse status, não update
    if (shipping.status === newStatus) {
      console.info(`[Shipping] webhook idempotente ignorado (melhorEnvioId=${melhorEnvioId}, status=${newStatus})`);
      return shipping;
    }

    // Update
    const previousStatus = shipping.status;
    shipping.status = newStatus;
    shipping.history.push({
      timestamp: new Date(),
      status: newStatus,
      description: `Status atualizado via webhook`,
      melhorEnvioStatus,
    });

    await shipping.save();
    console.info(
      `[Shipping] status atualizado (melhorEnvioId=${melhorEnvioId}, de=${previousStatus}, para=${newStatus})`,
    );

    const subOrder = await SubOrder.findById(shipping.subOrder).select("_id order status");
    if (subOrder) {
      if ([shippingStatuses.POSTED, shippingStatuses.IN_TRANSIT].includes(newStatus)) {
        subOrder.status = subOrderStatuses.SHIPPING;
      }

      if (newStatus === shippingStatuses.DELIVERED) {
        subOrder.status = subOrderStatuses.DELIVERED;
      }

      if ([shippingStatuses.FAILED, shippingStatuses.CANCELLED].includes(newStatus)) {
        subOrder.status = subOrderStatuses.FAILED;
      }

      await subOrder.save();
      await this.syncOrderStatus(subOrder.order);
    }

    return shipping;
  }

  /**
   * Sincroniza Order status baseado em SubOrder states
   * Chamado após atualização de shipping
   */
  async syncOrderStatus(orderId) {
    const subOrders = await SubOrder.find({ order: orderId });

    if (subOrders.length === 0) {
      return;
    }

    // O Order pai aceita apenas: pending, paid, failed, cancelled
    // Status operacionais de fulfillment permanecem representados em SubOrder/Shipping.
    const statuses = subOrders.map((s) => s.status);

    let orderStatus = orderStatuses.PENDING;
    if (statuses.every((s) => s === subOrderStatuses.CANCELLED)) {
      orderStatus = orderStatuses.CANCELLED;
    } else if (statuses.every((s) => s === subOrderStatuses.FAILED)) {
      orderStatus = orderStatuses.FAILED;
    } else if (
      statuses.some((s) =>
        [subOrderStatuses.PAID, subOrderStatuses.PROCESSING, subOrderStatuses.SHIPPING, subOrderStatuses.DELIVERED].includes(s),
      )
    ) {
      orderStatus = orderStatuses.PAID;
    }

    const order = await Order.findByIdAndUpdate(orderId, { status: orderStatus }, { new: true });

    return order;
  }

  // ===== HELPERS =====

  mapCarrierName(meCarrierName) {
    const mapping = {
      SEDEX: "sedex",
      Sedex: "sedex",
      PAC: "pac",
      Pac: "pac",
      JADLOG: "jadlog",
      LOGGI: "loggi",
      "Azul Cargo": "azul",
      Correios: "correios",
    };
    return mapping[meCarrierName] || "correios";
  }

  getServiceId(carrierName) {
    const normalizedCarrierName = String(carrierName ?? "").trim().toUpperCase();
    return MELHOR_ENVIO_CONFIG.carriers[normalizedCarrierName]?.id || 1;
  }

  calculateDeliveryDate(deliveryTimeDays) {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(deliveryTimeDays));
    return date;
  }
}

export default new ShippingService();
