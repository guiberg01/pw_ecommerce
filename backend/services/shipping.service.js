import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Shipping from "../models/shipping.model.js";
import ShippingQuote from "../models/shippingQuote.model.js";
import melhorenvioService from "./melhorenvio.service.js";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";

/**
 * Serviço de Orquestração de Shipping
 * Coordena:
 * - Cálculo de fretes (cotação)
 * - Seleção de transportadora
 * - Geração de etiquetas
 * - Sincronização de status com webhooks
 */

class ShippingService {
  /**
   * Obtém opções de frete para um subOrder
   * Chama MelhorEnvio API sempre para ter cotação fresca
   */
  async getShippingOptions(subOrderId, forceRecalculate = false) {
    const subOrder = await SubOrder.findById(subOrderId)
      .populate("order")
      .populate({ path: "store", populate: { path: "address" } })
      .populate("items.productVariantId");

    if (!subOrder) {
      throw {
        errorCode: "SUBORDER_NOT_FOUND",
        message: "SubOrder não encontrada",
      };
    }

    const order = subOrder.order;
    if (!order.shippingAddress) {
      throw {
        errorCode: "SHIPPING_ADDRESS_REQUIRED",
        message: "Endereço de entrega não configurado no pedido",
      };
    }

    const store = subOrder.store;
    if (!store.address) {
      throw {
        errorCode: "STORE_ADDRESS_REQUIRED",
        message: "Endereço da loja não configurado",
      };
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

    // Determinar quem paga
    let whoPays = "customer_pays";
    let freeShipping = false;

    // TODO: verificar se coupon tem frete grátis
    if (subOrder.coupon?.scope === "platform" && subOrder.coupon.code?.includes("frete")) {
      whoPays = "platform_paid";
      freeShipping = true;
    }

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
  async selectShippingOption(subOrderId, carrierId, quoteId) {
    const subOrder = await SubOrder.findById(subOrderId).populate("order").populate("store");

    if (!subOrder) {
      throw {
        errorCode: "SUBORDER_NOT_FOUND",
        message: "SubOrder não encontrada",
      };
    }

    const quote = await ShippingQuote.findById(quoteId);
    if (!quote) {
      throw {
        errorCode: "QUOTE_NOT_FOUND",
        message: "Cotação de frete não encontrada",
      };
    }

    // Validar que carrier é válido
    const selectedCarrier = quote.carriers.find((c) => String(c.id) === String(carrierId));
    if (!selectedCarrier) {
      throw {
        errorCode: "INVALID_CARRIER",
        message: "Transportadora selecionada não é válida",
      };
    }

    // Atualizar quote com seleção
    quote.selectedCarrier = selectedCarrier;
    await quote.save();

    // Criar registro de Shipping (ainda pending, sem etiqueta no ME)
    const shipping = new Shipping({
      store: subOrder.store._id,
      subOrder: subOrderId,
      carrier: this.mapCarrierName(selectedCarrier.name),
      whoPays: quote.whoPays,
      shippingCost: quote.freeShipping ? 0 : selectedCarrier.price,
      estimatedDeliveryDate: this.calculateDeliveryDate(selectedCarrier.deliveryTime),
      status: "pending",
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
  async generateLabel(subOrderId) {
    const subOrder = await SubOrder.findById(subOrderId)
      .populate({ path: "order", populate: { path: "user", select: "email" } })
      .populate({
        path: "store",
        populate: [{ path: "address" }, { path: "owner", select: "email" }],
      })
      .populate("shipping");

    if (!subOrder) {
      throw {
        errorCode: "SUBORDER_NOT_FOUND",
        message: "SubOrder não encontrada",
      };
    }

    if (!subOrder.shipping) {
      throw {
        errorCode: "SHIPPING_NOT_CONFIGURED",
        message: "Frete não foi configurado para este subOrder",
      };
    }

    const shipping = subOrder.shipping;
    const order = subOrder.order;
    const store = subOrder.store;

    // Validar status do Order (precisa estar paid)
    if (order.status !== "paid") {
      throw {
        errorCode: "ORDER_NOT_PAID",
        message: `Pedido deve estar pago antes de gerar etiqueta. Status atual: ${order.status}`,
      };
    }

    // Validar endereços
    if (!order.shippingAddress || !store.address) {
      throw {
        errorCode: "ADDRESSES_REQUIRED",
        message: "Endereços de origem ou destino não configurados",
      };
    }

    // Montar payload para criar etiqueta
    const payload = {
      service: this.getServiceId(shipping.carrier),
      from: {
        name: store.name,
        phone: store.address.phoneNumber || "0000000000",
        email: store.owner?.email || null,
        document: store.cnpj || "", // IMPORTANTE para comercial
        state_register: "",
        document_type: "CNPJ",
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
        document_type: "CPF",
        postal_code: order.shippingAddress.zipCode.replace("-", ""),
        address: order.shippingAddress.street,
        number: order.shippingAddress.number,
        complement: order.shippingAddress.complement || "",
        district: order.shippingAddress.neighborhood,
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
      },
      products: subOrder.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitary_value: item.price,
      })),
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
      receipt: true, // Solicitar confirmação de entrega
      own_hand: false,
      value: order.totalPriceProducts,
      insurance_value: order.totalPriceProducts,
      reference: `ORDER_${order._id}`,
    };

    // Chamar API MelhorEnvio
    const labelResult = await melhorenvioService.createShippingLabel(store._id, payload);

    // Atualizar Shipping com dados do ME
    shipping.melhorEnvioOrderId = labelResult.id;
    shipping.status = "posted";
    shipping.trackingCode = labelResult.tracking;
    shipping.labelUrl = labelResult.labelUrl;
    shipping.history.push({
      timestamp: new Date(),
      status: "posted",
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
   * Atualiza status de shipping via webhook ou polling
   */
  async updateLabelStatus(melhorEnvioId, melhorEnvioStatus) {
    const shipping = await Shipping.findOne({
      melhorEnvioOrderId: melhorEnvioId,
    });

    if (!shipping) {
      console.warn(`[Shipping] Etiqueta ${melhorEnvioId} não encontrada no BD`);
      return null;
    }

    // Mapear status ME → nosso status
    const newStatus = MELHOR_ENVIO_CONFIG.statusMap[melhorEnvioStatus] || melhorEnvioStatus;

    // Se já tem esse status, não update
    if (shipping.status === newStatus) {
      return shipping;
    }

    // Update
    shipping.status = newStatus;
    shipping.history.push({
      timestamp: new Date(),
      status: newStatus,
      description: `Status atualizado via webhook`,
      melhorEnvioStatus,
    });

    await shipping.save();

    const subOrder = await SubOrder.findById(shipping.subOrder).select("_id order status");
    if (subOrder) {
      if (["posted", "in_transit"].includes(newStatus)) {
        subOrder.status = "shipping";
      }

      if (newStatus === "delivered") {
        subOrder.status = "delivered";
      }

      if (["failed", "cancelled"].includes(newStatus)) {
        subOrder.status = "failed";
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

    let orderStatus = "pending";
    if (statuses.every((s) => s === "cancelled")) {
      orderStatus = "cancelled";
    } else if (statuses.every((s) => s === "failed")) {
      orderStatus = "failed";
    } else if (statuses.some((s) => ["paid", "processing", "shipping", "delivered"].includes(s))) {
      orderStatus = "paid";
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
    return MELHOR_ENVIO_CONFIG.carriers[carrierName.toUpperCase()]?.id || 1;
  }

  calculateDeliveryDate(deliveryTimeDays) {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(deliveryTimeDays));
    return date;
  }
}

export default new ShippingService();
