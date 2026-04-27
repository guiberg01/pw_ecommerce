import mongoose from "mongoose";
import Stripe from "stripe";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Shipping from "../models/shipping.model.js";
import ProductVariant from "../models/productVariant.model.js";
import Address from "../models/address.model.js";
import PaymentMethod from "../models/paymentMethod.model.js";
import Payment from "../models/payment.model.js";
import Coupon from "../models/coupon.model.js";
import CouponUsage from "../models/couponUsage.model.js";
import Payout from "../models/payout.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import melhorenvioService from "./melhorenvio.service.js";
import shippingService from "./shipping.service.js";
import { notifyOrderFailedOrCancelled, notifyOrderPaid, notifyRefundEvent } from "./notification.service.js";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const CHECKOUT_EVENT_SOURCE = "stripe_webhook";
const DEFAULT_COMMISSION_RATE = 10;

const stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const getStripeClientOrThrow = () => {
  if (!stripeClient) {
    throw createHttpError("Stripe não configurado", 500, undefined, "STRIPE_NOT_CONFIGURED");
  }

  return stripeClient;
};

const buildStripeWebhookEventOrThrow = (payloadBuffer, signature) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw createHttpError("Webhook do Stripe não configurado", 500, undefined, "STRIPE_WEBHOOK_NOT_CONFIGURED");
  }

  if (!signature) {
    throw createHttpError("Assinatura Stripe ausente", 400, undefined, "STRIPE_WEBHOOK_SIGNATURE_MISSING");
  }

  try {
    return getStripeClientOrThrow().webhooks.constructEvent(payloadBuffer, signature, webhookSecret);
  } catch {
    throw createHttpError("Assinatura Stripe inválida", 400, undefined, "STRIPE_WEBHOOK_SIGNATURE_INVALID");
  }
};

const isEventAlreadyProcessed = (payment, stripeEventId) => {
  return (payment.events ?? []).some(
    (event) => event?.source === CHECKOUT_EVENT_SOURCE && event?.stripeEventId === stripeEventId,
  );
};

const appendPaymentEvent = ({ payment, stripeEventId, type, metadata = {} }) => {
  payment.events = [
    ...(payment.events ?? []),
    {
      source: CHECKOUT_EVENT_SOURCE,
      stripeEventId,
      type,
      at: new Date(),
      metadata,
    },
  ];
};

const PAYMENT_ATTEMPT_PRIORITY = {
  succeeded: 600,
  partially_refunded: 500,
  refunded: 400,
  requires_action: 300,
  pending: 200,
  failed: 100,
};

const paymentAttemptSortByPriority = (a, b) => {
  const byPriority = (PAYMENT_ATTEMPT_PRIORITY[b.status] ?? 0) - (PAYMENT_ATTEMPT_PRIORITY[a.status] ?? 0);
  if (byPriority !== 0) return byPriority;

  const byPaidAt = new Date(b.paidAt ?? 0).getTime() - new Date(a.paidAt ?? 0).getTime();
  if (byPaidAt !== 0) return byPaidAt;

  return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
};

const resolvePrimaryPaymentAttemptForOrder = async (orderId) => {
  const attempts = await Payment.find({ order: orderId })
    .select("_id order status stripeChargeId paidAt createdAt")
    .lean();

  if (!attempts.length) {
    return null;
  }

  const [primaryAttempt] = [...attempts].sort(paymentAttemptSortByPriority);
  return primaryAttempt ?? null;
};

const mapStripeIntentStatusToPaymentStatus = (stripeStatus) => {
  switch (String(stripeStatus ?? "")) {
    case "succeeded":
      return "succeeded";
    case "requires_action":
      return "requires_action";
    case "canceled":
      return "failed";
    case "requires_payment_method":
    case "requires_confirmation":
    case "processing":
    default:
      return "pending";
  }
};

const consumeCouponIfNeeded = async ({ session, couponSnapshot, orderId, userId }) => {
  if (!couponSnapshot?.couponId) return;

  const existingUsage = await CouponUsage.findOne({
    coupon: couponSnapshot.couponId,
    user: userId,
    order: orderId,
  }).session(session);

  if (existingUsage) return;

  await CouponUsage.create(
    [
      {
        coupon: couponSnapshot.couponId,
        user: userId,
        order: orderId,
        usedAt: new Date(),
      },
    ],
    { session },
  );

  const couponDoc = await Coupon.findById(couponSnapshot.couponId).session(session);
  if (!couponDoc) return;

  couponDoc.usedCount = Number(couponDoc.usedCount ?? 0) + 1;

  if (couponDoc.maxUses != null && couponDoc.usedCount >= Number(couponDoc.maxUses)) {
    couponDoc.status = "sold-out";
  }

  await couponDoc.save({ session });
};

const getCommissionRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_COMMISSION_RATE;
  if (parsed < 0) return 0;
  if (parsed > 100) return 100;
  return parsed;
};

const buildShippingSnapshot = (address) => ({
  label: address.label,
  zipCode: address.zipCode,
  street: address.street,
  number: address.number,
  complement: address.complement,
  neighborhood: address.neighborhood,
  city: address.city,
  state: address.state,
  receiverName: address.receiverName,
  phoneNumber: address.phoneNumber,
  location: address.location,
});

const validateCouponByContextOrThrow = async ({ couponCode, subTotal, items, userId, session }) => {
  if (!couponCode) {
    return {
      coupon: null,
      discountAmount: 0,
      eligibleItemKeys: new Set(),
    };
  }

  const coupon = await Coupon.findOne({ code: couponCode, status: { $in: ["active", "sold-out"] } }).session(session);

  if (!coupon) {
    throw createHttpError("Cupom inválido ou indisponível", 400, undefined, "CHECKOUT_COUPON_INVALID");
  }

  if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
    throw createHttpError("Cupom expirado", 400, undefined, "CHECKOUT_COUPON_EXPIRED");
  }

  if (coupon.maxUses != null && Number(coupon.usedCount ?? 0) >= Number(coupon.maxUses)) {
    throw createHttpError("Cupom indisponível", 400, undefined, "CHECKOUT_COUPON_SOLD_OUT");
  }

  const userUsageCount = await CouponUsage.countDocuments({
    coupon: coupon._id,
    user: userId,
    order: { $ne: null },
  }).session(session);
  if (coupon.maxUsesPerUser != null && userUsageCount >= Number(coupon.maxUsesPerUser)) {
    throw createHttpError("Limite de uso do cupom atingido", 400, undefined, "CHECKOUT_COUPON_MAX_USES_PER_USER");
  }

  if (subTotal < Number(coupon.minOrderValue ?? 0)) {
    throw createHttpError("Subtotal abaixo do mínimo para uso do cupom", 400, undefined, "CHECKOUT_COUPON_MIN_ORDER");
  }

  const productFilterSet = new Set((coupon.products ?? []).map((id) => id.toString()));
  const storeFilterSet = new Set((coupon.stores ?? []).map((id) => id.toString()));
  const categoryFilterSet = new Set((coupon.categories ?? []).map((id) => id.toString()));

  const eligibleItems = items.filter((item) => {
    const inProductFilter = productFilterSet.size === 0 || productFilterSet.has(item.productId);
    const inStoreFilter = storeFilterSet.size === 0 || storeFilterSet.has(item.storeId);
    const inCategoryFilter =
      categoryFilterSet.size === 0 || item.categoryIds.some((categoryId) => categoryFilterSet.has(categoryId));

    return inProductFilter && inStoreFilter && inCategoryFilter;
  });

  if (eligibleItems.length === 0) {
    throw createHttpError(
      "Cupom não aplicável aos itens do carrinho",
      400,
      undefined,
      "CHECKOUT_COUPON_NOT_APPLICABLE",
    );
  }

  const eligibleSubTotal = roundMoney(eligibleItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));

  let discountAmount =
    coupon.discountType === "percentage"
      ? roundMoney((eligibleSubTotal * Number(coupon.discountValue ?? 0)) / 100)
      : roundMoney(Number(coupon.discountValue ?? 0));

  discountAmount = Math.min(discountAmount, eligibleSubTotal);

  if (coupon.maxDiscountAmount != null) {
    discountAmount = Math.min(discountAmount, Number(coupon.maxDiscountAmount));
  }

  return {
    coupon,
    discountAmount: roundMoney(discountAmount),
    eligibleItemKeys: new Set(eligibleItems.map((item) => item.productVariantId)),
  };
};

const buildSubOrders = ({
  orderId,
  groupedByStore,
  totalDiscount,
  coupon,
  eligibleItemKeys,
  commissionRateByStore,
  shippingByStore,
}) => {
  const stores = Array.from(groupedByStore.values());
  const subTotalAllStores = roundMoney(stores.reduce((sum, store) => sum + store.subTotal, 0));
  let allocatedDiscount = 0;

  return stores.map((storeGroup, index) => {
    const eligibleSubTotal = roundMoney(
      storeGroup.items
        .filter((item) => eligibleItemKeys.has(item.productVariantId.toString()))
        .reduce((sum, item) => sum + item.price * item.quantity, 0),
    );

    let storeDiscount = 0;

    if (totalDiscount > 0 && eligibleSubTotal > 0) {
      if (index === stores.length - 1) {
        storeDiscount = roundMoney(totalDiscount - allocatedDiscount);
      } else {
        storeDiscount = roundMoney((eligibleSubTotal / Math.max(subTotalAllStores, 1)) * totalDiscount);
      }
    }

    allocatedDiscount = roundMoney(allocatedDiscount + storeDiscount);

    const shippingCost = Number(shippingByStore.get(storeGroup.storeId.toString())?.shippingCost ?? 0);
    const commissionRate = getCommissionRate(commissionRateByStore.get(storeGroup.storeId.toString()));
    const platformFee = roundMoney(((storeGroup.subTotal - storeDiscount + shippingCost) * commissionRate) / 100);
    const vendorNetAmount = roundMoney(storeGroup.subTotal - storeDiscount + shippingCost - platformFee);

    return {
      order: orderId,
      store: storeGroup.storeId,
      items: storeGroup.items,
      coupon: coupon
        ? {
            couponId: coupon._id,
            code: coupon.code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            scope: coupon.scope,
          }
        : undefined,
      subTotal: storeGroup.subTotal,
      shippingCost,
      discountAmount: storeDiscount,
      platformFee,
      vendorNetAmount,
      status: "pending",
    };
  });
};

const buildStoreConnectContext = async (groupedByStore, session) => {
  const storeIds = Array.from(groupedByStore.values()).map((entry) => entry.storeId);
  const stores = await Store.find({ _id: { $in: storeIds }, status: "active" })
    .select("stripeConnectId commissionRate")
    .session(session);

  if (stores.length !== storeIds.length) {
    throw createHttpError("Uma ou mais lojas do carrinho estão inválidas", 400, undefined, "CHECKOUT_STORE_INVALID");
  }

  const map = new Map();
  for (const store of stores) {
    map.set(store._id.toString(), {
      storeId: store._id,
      stripeConnectId: store.stripeConnectId,
      commissionRate: getCommissionRate(store.commissionRate),
    });
  }

  return map;
};

const normalizeCartForCheckoutOrThrow = async (userId, session) => {
  const cart = await Cart.findOne({ user: userId })
    .session(session)
    .populate({
      path: "items.productVariant",
      select: "price stock sku imageUrl product weight length width height",
      populate: {
        path: "product",
        select: "name maxPerPerson status category store",
        populate: {
          path: "store",
          select: "status",
        },
      },
    });

  if (!cart || (cart.items ?? []).length === 0) {
    throw createHttpError("Carrinho vazio", 400, undefined, "CHECKOUT_CART_EMPTY");
  }

  const normalizedItems = [];
  const groupedByStore = new Map();

  for (const cartItem of cart.items) {
    const productVariant = cartItem.productVariant;
    const product = productVariant?.product;

    if (!productVariant || !product) {
      throw createHttpError("Carrinho possui item inválido", 400, undefined, "CHECKOUT_INVALID_CART_ITEM");
    }

    if (product.status !== "active" || product.store?.status !== "active") {
      throw createHttpError("Carrinho possui item indisponível", 400, undefined, "CHECKOUT_ITEM_UNAVAILABLE");
    }

    const quantity = Number(cartItem.quantity ?? 0);
    if (quantity <= 0) {
      throw createHttpError(
        "Carrinho possui item com quantidade inválida",
        400,
        undefined,
        "CHECKOUT_INVALID_QUANTITY",
      );
    }

    if (quantity > Number(productVariant.stock ?? 0)) {
      throw createHttpError(
        "Estoque insuficiente para um ou mais itens",
        400,
        undefined,
        "CHECKOUT_STOCK_INSUFFICIENT",
      );
    }

    if (product.maxPerPerson != null && quantity > Number(product.maxPerPerson)) {
      throw createHttpError(
        "Um ou mais itens ultrapassam o limite máximo por pessoa",
        400,
        undefined,
        "CHECKOUT_MAX_PER_PERSON_EXCEEDED",
      );
    }

    const normalizedItem = {
      productVariantId: productVariant._id,
      productId: product._id.toString(),
      storeId: product.store._id.toString(),
      categoryIds: (product.category ?? []).map((categoryId) => categoryId.toString()),
      name: product.name,
      sku: productVariant.sku,
      unitPrice: roundMoney(productVariant.price),
      quantity,
      imageUrl: productVariant.imageUrl,
      weight: Number(productVariant.weight ?? 0) || 0,
      length: Number(productVariant.length ?? 0) || 0,
      width: Number(productVariant.width ?? 0) || 0,
      height: Number(productVariant.height ?? 0) || 0,
    };

    normalizedItems.push(normalizedItem);

    if (!groupedByStore.has(normalizedItem.storeId)) {
      groupedByStore.set(normalizedItem.storeId, {
        storeId: product.store._id,
        items: [],
        subTotal: 0,
      });
    }

    const storeGroup = groupedByStore.get(normalizedItem.storeId);
    storeGroup.items.push({
      productVariantId: normalizedItem.productVariantId,
      name: normalizedItem.name,
      sku: normalizedItem.sku,
      price: normalizedItem.unitPrice,
      quantity: normalizedItem.quantity,
      imageUrl: normalizedItem.imageUrl,
      weight: normalizedItem.weight,
      length: normalizedItem.length,
      width: normalizedItem.width,
      height: normalizedItem.height,
    });
    storeGroup.subTotal = roundMoney(storeGroup.subTotal + normalizedItem.unitPrice * normalizedItem.quantity);
  }

  return { cart, normalizedItems, groupedByStore };
};

const normalizeCarrierId = (carrierId) => String(carrierId ?? "").trim();

const buildCheckoutCartFingerprint = (groupedByStore) => {
  return JSON.stringify(
    Array.from(groupedByStore.entries())
      .map(([storeId, storeGroup]) => ({
        storeId: storeId.toString(),
        subTotal: roundMoney(storeGroup.subTotal),
        items: (storeGroup.items ?? [])
          .map((item) => ({
            productVariantId: item.productVariantId.toString(),
            quantity: Number(item.quantity ?? 0),
            unitPrice: roundMoney(item.price),
          }))
          .sort((a, b) => a.productVariantId.localeCompare(b.productVariantId)),
      }))
      .sort((a, b) => a.storeId.localeCompare(b.storeId)),
  );
};

const normalizeShippingSelectionsByStore = (shippingSelections = []) => {
  if (!Array.isArray(shippingSelections) || shippingSelections.length === 0) {
    throw createHttpError(
      "Seleção de frete obrigatória para finalizar o checkout",
      400,
      undefined,
      "CHECKOUT_SHIPPING_SELECTION_REQUIRED",
    );
  }

  const byStore = new Map();
  for (const selection of shippingSelections) {
    const storeId = String(selection?.storeId ?? "").trim();
    const carrierId = normalizeCarrierId(selection?.carrierId);

    if (!storeId || !carrierId) {
      throw createHttpError("Seleção de frete inválida", 400, { selection }, "CHECKOUT_SHIPPING_SELECTION_INVALID");
    }

    byStore.set(storeId, {
      storeId,
      carrierId,
    });
  }

  return byStore;
};

const buildShippingProductsPayload = (items = []) => {
  return items.map((item) => ({
    id: item.productVariantId.toString(),
    width: item.width || 10,
    height: item.height || 10,
    length: item.length || 10,
    weight: item.weight || 0.5,
    quantity: item.quantity,
    insurance_value: Number(item.price ?? 0) * Number(item.quantity ?? 0),
  }));
};

const resolveFreightPolicyByCoupon = (coupon) => {
  return shippingService.resolveFreightPolicy({ coupon });
};

const calculateShippingByStoreForCheckoutOrThrow = async ({
  groupedByStore,
  shippingSelectionsByStore,
  address,
  coupon,
}) => {
  const storeIds = Array.from(groupedByStore.keys());

  if (shippingSelectionsByStore.size !== storeIds.length) {
    throw createHttpError(
      "Selecione o frete de todas as lojas antes de finalizar",
      400,
      { expectedStores: storeIds.length, selectedStores: shippingSelectionsByStore.size },
      "CHECKOUT_SHIPPING_SELECTION_INCOMPLETE",
    );
  }

  const stores = await Store.find({ _id: { $in: storeIds }, status: "active" })
    .select("_id address")
    .populate("address", "zipCode street number complement neighborhood city state");

  const storeById = new Map(stores.map((store) => [store._id.toString(), store]));
  const shippingByStore = new Map();
  let totalShippingPrice = 0;

  const freightPolicy = resolveFreightPolicyByCoupon(coupon);

  for (const storeId of storeIds) {
    const store = storeById.get(storeId);
    if (!store) {
      throw createHttpError("Uma ou mais lojas do carrinho estão inválidas", 400, undefined, "CHECKOUT_STORE_INVALID");
    }

    if (!store.address) {
      throw createHttpError(
        "Uma ou mais lojas não possuem endereço para cálculo de frete",
        400,
        { storeId },
        "CHECKOUT_STORE_ADDRESS_MISSING",
      );
    }

    const selection = shippingSelectionsByStore.get(storeId);
    if (!selection) {
      throw createHttpError(
        "Seleção de frete ausente para uma das lojas",
        400,
        { storeId },
        "CHECKOUT_SHIPPING_SELECTION_MISSING_STORE",
      );
    }

    const storeGroup = groupedByStore.get(storeId);

    const shippingPayload = {
      from: {
        postal_code: String(store.address.zipCode ?? "").replace("-", ""),
        address: store.address.street,
        number: store.address.number,
        complement: store.address.complement || "",
        district: store.address.neighborhood,
        city: store.address.city,
        state: store.address.state,
      },
      to: {
        postal_code: String(address.zipCode ?? "").replace("-", ""),
        address: address.street,
        number: address.number,
        complement: address.complement || "",
        district: address.neighborhood,
        city: address.city,
        state: address.state,
      },
      products: buildShippingProductsPayload(storeGroup.items),
    };

    const quoteResult = await melhorenvioService.calculateShipping(store._id, shippingPayload);
    const carriers = Array.isArray(quoteResult?.carriers) ? quoteResult.carriers : [];

    const selectedCarrier = carriers.find((carrier) => normalizeCarrierId(carrier?.id) === selection.carrierId);
    if (!selectedCarrier) {
      throw createHttpError(
        "Transportadora selecionada é inválida ou expirou",
        400,
        { storeId, carrierId: selection.carrierId },
        "CHECKOUT_SHIPPING_CARRIER_INVALID",
      );
    }

    const selectedCarrierPrice = roundMoney(Number(selectedCarrier.custom_price ?? selectedCarrier.price ?? 0));
    if (!Number.isFinite(selectedCarrierPrice) || selectedCarrierPrice < 0) {
      throw createHttpError(
        "Valor de frete inválido retornado pela transportadora",
        502,
        { storeId, carrierId: selection.carrierId },
        "CHECKOUT_SHIPPING_PRICE_INVALID",
      );
    }

    const shippingCost = freightPolicy.whoPays === "platform_paid" ? 0 : selectedCarrierPrice;
    totalShippingPrice = roundMoney(totalShippingPrice + shippingCost);

    shippingByStore.set(storeId, {
      shippingCost,
      whoPays: freightPolicy.whoPays,
      freeShipping: freightPolicy.freeShipping,
      selectedCarrier: {
        id: selectedCarrier.id,
        name: selectedCarrier.name,
        price: selectedCarrierPrice,
        deliveryTime: Number(selectedCarrier.delivery_time ?? 0),
      },
    });
  }

  return {
    shippingByStore,
    totalShippingPrice,
  };
};

export const getCheckoutShippingOptionsForUser = async (userId, payload) => {
  const { addressId, couponCode } = payload;

  const [address, cartContext] = await Promise.all([
    Address.findOne({ _id: addressId, user: userId }).lean(),
    normalizeCartForCheckoutOrThrow(userId),
  ]);

  if (!address) {
    throw createHttpError("Endereço não encontrado", 404, undefined, "CHECKOUT_ADDRESS_NOT_FOUND");
  }

  const subTotal = roundMoney(
    cartContext.normalizedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );
  const couponContext = await validateCouponByContextOrThrow({
    couponCode,
    subTotal,
    items: cartContext.normalizedItems,
    userId,
  });

  const freightPolicy = resolveFreightPolicyByCoupon(couponContext.coupon);
  const storeIds = Array.from(cartContext.groupedByStore.keys());

  const stores = await Store.find({ _id: { $in: storeIds }, status: "active" })
    .select("_id name address")
    .populate("address", "zipCode street number complement neighborhood city state");

  const storeById = new Map(stores.map((store) => [store._id.toString(), store]));
  const options = [];

  for (const storeId of storeIds) {
    const store = storeById.get(storeId);
    if (!store) {
      throw createHttpError("Uma ou mais lojas do carrinho estão inválidas", 400, undefined, "CHECKOUT_STORE_INVALID");
    }

    if (!store.address) {
      throw createHttpError(
        "Uma ou mais lojas não possuem endereço para cálculo de frete",
        400,
        { storeId },
        "CHECKOUT_STORE_ADDRESS_MISSING",
      );
    }

    const storeGroup = cartContext.groupedByStore.get(storeId);
    const shippingPayload = {
      from: {
        postal_code: String(store.address.zipCode ?? "").replace("-", ""),
        address: store.address.street,
        number: store.address.number,
        complement: store.address.complement || "",
        district: store.address.neighborhood,
        city: store.address.city,
        state: store.address.state,
      },
      to: {
        postal_code: String(address.zipCode ?? "").replace("-", ""),
        address: address.street,
        number: address.number,
        complement: address.complement || "",
        district: address.neighborhood,
        city: address.city,
        state: address.state,
      },
      products: buildShippingProductsPayload(storeGroup.items),
    };

    const quoteResult = await melhorenvioService.calculateShipping(store._id, shippingPayload);
    const carriers = (Array.isArray(quoteResult?.carriers) ? quoteResult.carriers : []).map((carrier) => {
      const rawPrice = roundMoney(Number(carrier.custom_price ?? carrier.price ?? 0));
      const shippingCost = freightPolicy.whoPays === "platform_paid" ? 0 : rawPrice;

      return {
        id: carrier.id,
        name: carrier.name,
        price: rawPrice,
        shippingCost,
        deliveryTime: Number(carrier.delivery_time ?? 0),
      };
    });

    options.push({
      storeId,
      storeName: store.name,
      whoPays: freightPolicy.whoPays,
      freeShipping: freightPolicy.freeShipping,
      recommendedCarrierId: carriers[0]?.id ?? null,
      carriers,
    });
  }

  return {
    addressId,
    couponCode: couponContext.coupon?.code ?? null,
    recommendedCarrierId: options[0]?.recommendedCarrierId ?? null,
    stores: options,
  };
};

export const createCheckoutIntentForUser = async (userId, payload) => {
  const { addressId, paymentMethodId, couponCode, shippingSelections } = payload;

  const [shippingAddress, shippingCartContext] = await Promise.all([
    Address.findOne({ _id: addressId, user: userId }).lean(),
    normalizeCartForCheckoutOrThrow(userId),
  ]);

  if (!shippingAddress) {
    throw createHttpError("Endereço não encontrado", 404, undefined, "CHECKOUT_ADDRESS_NOT_FOUND");
  }

  const shippingSubTotal = roundMoney(
    shippingCartContext.normalizedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );

  const shippingCouponContext = await validateCouponByContextOrThrow({
    couponCode,
    subTotal: shippingSubTotal,
    items: shippingCartContext.normalizedItems,
    userId,
  });

  const shippingSelectionsByStore = normalizeShippingSelectionsByStore(shippingSelections);
  const shippingContext = await calculateShippingByStoreForCheckoutOrThrow({
    groupedByStore: shippingCartContext.groupedByStore,
    shippingSelectionsByStore,
    address: shippingAddress,
    coupon: shippingCouponContext.coupon,
  });

  const shippingCartFingerprint = buildCheckoutCartFingerprint(shippingCartContext.groupedByStore);
  const shippingPolicyFingerprint = JSON.stringify(resolveFreightPolicyByCoupon(shippingCouponContext.coupon));

  const session = await mongoose.startSession();

  let order;
  let payment;
  let subOrders;
  let subTotal;
  let totalDiscount;
  let totalShippingPrice;
  let totalPaidByCustomer;
  let connectContextByStore;

  try {
    await session.withTransaction(async () => {
      const [address, paymentMethod, cartContext] = await Promise.all([
        Address.findOne({ _id: addressId, user: userId }).session(session),
        PaymentMethod.findOne({ _id: paymentMethodId, user: userId }).session(session),
        normalizeCartForCheckoutOrThrow(userId, session),
      ]);

      if (!address) {
        throw createHttpError("Endereço não encontrado", 404, undefined, "CHECKOUT_ADDRESS_NOT_FOUND");
      }

      if (!paymentMethod) {
        throw createHttpError(
          "Método de pagamento não encontrado",
          404,
          undefined,
          "CHECKOUT_PAYMENT_METHOD_NOT_FOUND",
        );
      }

      subTotal = roundMoney(cartContext.normalizedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));

      const couponContext = await validateCouponByContextOrThrow({
        couponCode,
        subTotal,
        items: cartContext.normalizedItems,
        userId,
        session,
      });

      const currentCartFingerprint = buildCheckoutCartFingerprint(cartContext.groupedByStore);
      if (currentCartFingerprint !== shippingCartFingerprint) {
        throw createHttpError(
          "Carrinho alterado durante o checkout. Recalcule o frete e tente novamente.",
          409,
          undefined,
          "CHECKOUT_CART_CHANGED_REQUIRES_RECALC",
        );
      }

      const currentPolicyFingerprint = JSON.stringify(resolveFreightPolicyByCoupon(couponContext.coupon));
      if (currentPolicyFingerprint !== shippingPolicyFingerprint) {
        throw createHttpError(
          "Condição de frete alterada. Recalcule o frete e tente novamente.",
          409,
          undefined,
          "CHECKOUT_SHIPPING_POLICY_CHANGED",
        );
      }

      totalDiscount = couponContext.discountAmount;

      totalShippingPrice = shippingContext.totalShippingPrice;
      totalPaidByCustomer = roundMoney(subTotal - totalDiscount + totalShippingPrice);
      connectContextByStore = await buildStoreConnectContext(cartContext.groupedByStore, session);

      // Revalida estoque dentro da transação para reduzir risco de corrida.
      const variantIds = cartContext.normalizedItems.map((item) => item.productVariantId);
      const variants = await ProductVariant.find({ _id: { $in: variantIds } })
        .session(session)
        .select("stock")
        .lean();
      const stockByVariant = new Map(variants.map((variant) => [variant._id.toString(), Number(variant.stock)]));

      for (const item of cartContext.normalizedItems) {
        const currentStock = stockByVariant.get(item.productVariantId.toString()) ?? 0;
        if (item.quantity > currentStock) {
          throw createHttpError(
            "Estoque insuficiente para um ou mais itens",
            400,
            undefined,
            "CHECKOUT_STOCK_INSUFFICIENT",
          );
        }
      }

      [order] = await Order.create(
        [
          {
            user: userId,
            totalPriceProducts: subTotal,
            totalPaidByCustomer,
            totalShippingPrice,
            totalDiscount,
            status: "pending",
            shippingAddress: buildShippingSnapshot(address),
          },
        ],
        { session },
      );

      const subOrderPayload = buildSubOrders({
        orderId: order._id,
        groupedByStore: cartContext.groupedByStore,
        totalDiscount,
        coupon: couponContext.coupon,
        eligibleItemKeys: couponContext.eligibleItemKeys,
        shippingByStore: shippingContext.shippingByStore,
        commissionRateByStore: new Map(
          Array.from(connectContextByStore.entries()).map(([storeId, context]) => [storeId, context.commissionRate]),
        ),
      });

      subOrders = await SubOrder.insertMany(subOrderPayload, { session });

      if (subOrders.length > 0) {
        const shippingDocsPayload = subOrders.map((subOrder) => {
          const shippingDetails = shippingContext.shippingByStore.get(subOrder.store.toString());

          return {
            store: subOrder.store,
            subOrder: subOrder._id,
            carrier: shippingService.mapCarrierName(shippingDetails.selectedCarrier.name),
            whoPays: shippingDetails.whoPays,
            shippingCost: subOrder.shippingCost,
            estimatedDeliveryDate: shippingService.calculateDeliveryDate(shippingDetails.selectedCarrier.deliveryTime),
            status: "pending",
            shippingServiceInfo: {
              selectedCarrier: shippingDetails.selectedCarrier,
              freeShipping: shippingDetails.freeShipping,
              quotedAt: new Date(),
            },
          };
        });

        const shippingDocs = await Shipping.insertMany(shippingDocsPayload, { session });
        const shippingIdBySubOrder = new Map(
          shippingDocs.map((shippingDoc) => [shippingDoc.subOrder.toString(), shippingDoc._id]),
        );

        for (const subOrder of subOrders) {
          const shippingId = shippingIdBySubOrder.get(subOrder._id.toString()) ?? null;
          subOrder.shipping = shippingId;
          await subOrder.save({ session });
        }
      }

      const platformRevenue = roundMoney(
        subOrderPayload.reduce((sum, subOrder) => sum + Number(subOrder.platformFee ?? 0), 0),
      );

      [payment] = await Payment.create(
        [
          {
            user: userId,
            order: order._id,
            amount: totalPaidByCustomer,
            currency: "BRL",
            paymentMethod: {
              type: paymentMethod.type,
              brand: paymentMethod.cardBrand,
              last4: paymentMethod.last4,
              installments: 1,
            },
            platformRevenue,
            status: "pending",
            events: [
              {
                type: "checkout_intent_created",
                at: new Date(),
                metadata: {
                  paymentMethodId: paymentMethod._id.toString(),
                  couponCode: couponContext.coupon?.code ?? null,
                  storeCount: connectContextByStore.size,
                },
              },
            ],
          },
        ],
        { session },
      );
    });

    let stripeIntent;
    try {
      stripeIntent = await getStripeClientOrThrow().paymentIntents.create({
        amount: Math.round(totalPaidByCustomer * 100),
        currency: "brl",
        automatic_payment_methods: { enabled: true },
        transfer_group: `order_${order._id}`,
        metadata: {
          orderId: order._id.toString(),
          paymentId: payment._id.toString(),
          userId: userId.toString(),
          storeCount: String(connectContextByStore.size),
        },
      });
    } catch (error) {
      await Promise.all([
        Payment.updateOne(
          { _id: payment._id, status: "pending" },
          {
            $set: { status: "failed" },
            $push: {
              events: {
                type: "checkout_intent_failed",
                at: new Date(),
                metadata: {
                  reason: error?.message ?? "stripe_intent_creation_failed",
                },
              },
            },
          },
        ),
        Order.updateOne({ _id: order._id, status: "pending" }, { $set: { status: "failed" } }),
        SubOrder.updateMany({ order: order._id, status: "pending" }, { $set: { status: "failed" } }),
      ]);

      throw createHttpError(
        "Falha ao iniciar pagamento no provedor",
        502,
        { orderId: order._id, paymentId: payment._id },
        "CHECKOUT_PAYMENT_INTENT_CREATION_FAILED",
      );
    }

    try {
      payment.stripePaymentIntentId = stripeIntent.id;
      order.stripePaymentId = stripeIntent.id;

      await Promise.all([payment.save(), order.save()]);
    } catch (error) {
      try {
        await getStripeClientOrThrow().paymentIntents.cancel(stripeIntent.id);
      } catch {
        // Se falhar para cancelar, o evento permanece rastreável via metadata no Stripe.
      }

      await Promise.all([
        Payment.updateOne(
          { _id: payment._id },
          {
            $set: { status: "failed" },
            $push: {
              events: {
                type: "checkout_intent_persistence_failed",
                at: new Date(),
                metadata: {
                  stripePaymentIntentId: stripeIntent.id,
                  reason: error?.message ?? "persist_failed_after_intent_creation",
                },
              },
            },
          },
        ),
        Order.updateOne({ _id: order._id, status: "pending" }, { $set: { status: "failed" } }),
        SubOrder.updateMany({ order: order._id, status: "pending" }, { $set: { status: "failed" } }),
      ]);

      throw createHttpError(
        "Falha ao persistir dados do pagamento",
        500,
        { orderId: order._id, paymentId: payment._id, stripePaymentIntentId: stripeIntent.id },
        "CHECKOUT_PAYMENT_PERSISTENCE_FAILED",
      );
    }

    return {
      orderId: order._id,
      paymentId: payment._id,
      paymentIntent: {
        provider: "stripe",
        status: stripeIntent.status,
        clientSecret: stripeIntent.client_secret,
        amountInCents: stripeIntent.amount,
        currency: String(stripeIntent.currency ?? "brl").toUpperCase(),
      },
      summary: {
        totalPriceProducts: subTotal,
        totalDiscount,
        totalShippingPrice,
        totalPaidByCustomer,
        subOrders: subOrders.map((subOrder) => ({
          id: subOrder._id,
          store: subOrder.store,
          subTotal: subOrder.subTotal,
          discountAmount: subOrder.discountAmount,
          shippingCost: subOrder.shippingCost,
          vendorNetAmount: subOrder.vendorNetAmount,
          status: subOrder.status,
        })),
      },
    };
  } finally {
    await session.endSession();
  }
};

export const resumeCheckoutIntentForUser = async (userId, orderId) => {
  const order = await Order.findOne({ _id: orderId, user: userId })
    .select("_id user status stripePaymentId totalPaidByCustomer")
    .lean();

  if (!order) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "CHECKOUT_ORDER_NOT_FOUND");
  }

  if (order.status === "paid") {
    throw createHttpError("Este pedido já foi pago", 409, undefined, "CHECKOUT_ALREADY_PAID");
  }

  if (order.status === "cancelled") {
    throw createHttpError("Pedido cancelado não pode ser retomado", 409, undefined, "CHECKOUT_ORDER_CANCELLED");
  }

  const payment = await Payment.findOne({ order: order._id, user: userId })
    .sort({ createdAt: -1 })
    .select("_id order user amount currency status stripePaymentIntentId events")
    .lean();

  if (!payment) {
    throw createHttpError("Pagamento não encontrado para este pedido", 404, undefined, "CHECKOUT_PAYMENT_NOT_FOUND");
  }

  const stripe = getStripeClientOrThrow();
  const storeCount = await SubOrder.countDocuments({ order: order._id });
  const amountInCents = Math.round(Number(payment.amount ?? order.totalPaidByCustomer ?? 0) * 100);

  if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
    throw createHttpError("Valor inválido para retomar pagamento", 400, undefined, "CHECKOUT_INVALID_PAYMENT_AMOUNT");
  }

  let paymentIntent = null;
  let reused = false;

  if (payment.stripePaymentIntentId) {
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    } catch {
      paymentIntent = null;
    }
  }

  if (paymentIntent?.status === "succeeded") {
    await markPaymentAsSucceededByIntentId({
      stripePaymentIntent: paymentIntent,
      stripeEventId: `manual_resume_sync_${paymentIntent.id}`,
    });

    const [updatedOrder, updatedPayment] = await Promise.all([
      Order.findById(order._id).select("_id status stripePaymentId").lean(),
      Payment.findById(payment._id).select("_id status stripePaymentIntentId paidAt").lean(),
    ]);

    return {
      orderId: order._id.toString(),
      paymentId: payment._id.toString(),
      resumed: false,
      synchronized: true,
      orderStatus: updatedOrder?.status ?? "paid",
      paymentStatus: updatedPayment?.status ?? "succeeded",
      paymentIntent: {
        provider: "stripe",
        status: paymentIntent.status,
        clientSecret: paymentIntent.client_secret,
        amountInCents: paymentIntent.amount,
        currency: String(paymentIntent.currency ?? payment.currency ?? "brl").toUpperCase(),
      },
    };
  }

  if (paymentIntent && paymentIntent.status !== "canceled") {
    reused = true;
  } else {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: String(payment.currency ?? "BRL").toLowerCase(),
      automatic_payment_methods: { enabled: true },
      transfer_group: `order_${order._id.toString()}`,
      metadata: {
        orderId: order._id.toString(),
        paymentId: payment._id.toString(),
        userId: userId.toString(),
        storeCount: String(storeCount),
        resumed: "true",
      },
    });

    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          stripePaymentIntentId: paymentIntent.id,
          status: mapStripeIntentStatusToPaymentStatus(paymentIntent.status),
        },
        $push: {
          events: {
            type: "checkout_intent_resumed",
            at: new Date(),
            metadata: {
              stripePaymentIntentId: paymentIntent.id,
            },
          },
        },
      },
    );

    await Order.updateOne(
      { _id: order._id, status: { $in: ["pending", "failed"] } },
      {
        $set: {
          status: "pending",
          stripePaymentId: paymentIntent.id,
        },
      },
    );

    await SubOrder.updateMany(
      { order: order._id, status: "failed" },
      {
        $set: { status: "pending" },
      },
    );
  }

  return {
    orderId: order._id.toString(),
    paymentId: payment._id.toString(),
    resumed: !reused,
    paymentIntent: {
      provider: "stripe",
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
      amountInCents: paymentIntent.amount,
      currency: String(paymentIntent.currency ?? payment.currency ?? "brl").toUpperCase(),
    },
  };
};

export const reconcileCheckoutOrderPaymentForUser = async (userId, orderId) => {
  const order = await Order.findOne({ _id: orderId, user: userId })
    .select("_id user status stripePaymentId")
    .lean();

  if (!order) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "CHECKOUT_ORDER_NOT_FOUND");
  }

  const payment = await Payment.findOne({ order: order._id, user: userId })
    .sort({ createdAt: -1 })
    .select("_id status stripePaymentIntentId")
    .lean();

  if (!payment) {
    throw createHttpError("Pagamento não encontrado para este pedido", 404, undefined, "CHECKOUT_PAYMENT_NOT_FOUND");
  }

  if (order.status === "paid" && payment.status === "succeeded") {
    return {
      orderId: order._id.toString(),
      paymentId: payment._id.toString(),
      synchronized: false,
      alreadyConsistent: true,
      orderStatus: order.status,
      paymentStatus: payment.status,
    };
  }

  const stripePaymentIntentId = payment.stripePaymentIntentId ?? order.stripePaymentId;

  if (!stripePaymentIntentId) {
    throw createHttpError(
      "Pagamento sem vínculo Stripe para reconciliação",
      409,
      { orderId: order._id, paymentId: payment._id },
      "CHECKOUT_RECONCILE_STRIPE_INTENT_MISSING",
    );
  }

  const stripePaymentIntent = await getStripeClientOrThrow().paymentIntents.retrieve(stripePaymentIntentId);

  if (stripePaymentIntent.status === "succeeded") {
    await markPaymentAsSucceededByIntentId({
      stripePaymentIntent,
      stripeEventId: `manual_reconcile_${stripePaymentIntent.id}_${Date.now()}`,
      metadata: {
        paymentId: payment._id.toString(),
        orderId: order._id.toString(),
        manualReconcile: true,
      },
    });

    const [updatedOrder, updatedPayment] = await Promise.all([
      Order.findById(order._id).select("_id status stripePaymentId").lean(),
      Payment.findById(payment._id).select("_id status stripePaymentIntentId paidAt").lean(),
    ]);

    return {
      orderId: order._id.toString(),
      paymentId: payment._id.toString(),
      synchronized: true,
      orderStatus: updatedOrder?.status ?? "paid",
      paymentStatus: updatedPayment?.status ?? "succeeded",
      stripeStatus: stripePaymentIntent.status,
    };
  }

  return {
    orderId: order._id.toString(),
    paymentId: payment._id.toString(),
    synchronized: false,
    orderStatus: order.status,
    paymentStatus: payment.status,
    stripeStatus: stripePaymentIntent.status,
  };
};

const resolvePaymentFromStripeEvent = async ({ session, stripePaymentIntentId, paymentId }) => {
  if (paymentId) {
    const paymentById = await Payment.findById(paymentId).session(session);
    if (paymentById) {
      return paymentById;
    }
  }

  if (stripePaymentIntentId) {
    return Payment.findOne({ stripePaymentIntentId }).session(session);
  }

  return null;
};

const markPaymentAsFailedByIntentId = async ({ stripePaymentIntentId, stripeEventId, eventType, metadata = {} }) => {
  const session = await mongoose.startSession();
  let failedOrderId = null;

  try {
    await session.withTransaction(async () => {
      const payment = await resolvePaymentFromStripeEvent({
        session,
        stripePaymentIntentId,
        paymentId: metadata.paymentId,
      });
      if (!payment) {
        throw createHttpError(
          "Pagamento ainda não registrado para esse evento",
          409,
          { stripePaymentIntentId, stripeEventId, eventType },
          "CHECKOUT_WEBHOOK_PAYMENT_NOT_READY",
        );
      }

      if (isEventAlreadyProcessed(payment, stripeEventId)) return;

      if (payment.status !== "succeeded") {
        payment.status = eventType === "payment_intent.requires_action" ? "requires_action" : "failed";
      }

      appendPaymentEvent({ payment, stripeEventId, type: eventType, metadata });
      await payment.save({ session });

      if (payment.status === "failed") {
        await Order.updateOne(
          { _id: payment.order, status: { $ne: "paid" } },
          { $set: { status: "failed" } },
          { session },
        );
        await SubOrder.updateMany(
          { order: payment.order, status: { $in: ["pending", "processing"] } },
          { $set: { status: "failed" } },
          { session },
        );

        failedOrderId = payment.order;
      }
    });

    if (failedOrderId) {
      await notifyOrderFailedOrCancelled({ orderId: failedOrderId });
    }
  } finally {
    await session.endSession();
  }
};

const tryDispatchPayoutTransfer = async ({ payout, payment, stripe }) => {
  if (payout.stripePayoutId) {
    return;
  }
  const store = await Store.findById(payout.store).select("stripeConnectId status").lean();

  if (!store || store.status !== "active") {
    payout.status = "failed";
    payout.failureMessage = "Loja inválida para transferência";
    await payout.save();
    return;
  }

  if (!store.stripeConnectId) {
    payout.status = "pending";
    payout.failureMessage = "Onboarding Stripe pendente para a loja";
    await payout.save();
    return;
  }

  const account = await stripe.accounts.retrieve(store.stripeConnectId);
  if (!account.charges_enabled || !account.payouts_enabled) {
    payout.status = "pending";
    payout.failureMessage = "Conta Stripe da loja ainda não habilitada para recebimento";
    await payout.save();
    return;
  }

  const amountInCents = Math.round(Number(payout.amount ?? 0) * 100);
  if (amountInCents <= 0) {
    payout.status = "cancelled";
    payout.failureMessage = "Valor de transferência inválido";
    await payout.save();
    return;
  }

  const transfer = await stripe.transfers.create({
    amount: amountInCents,
    currency: "brl",
    destination: store.stripeConnectId,
    transfer_group: `order_${payment.order.toString()}`,
    source_transaction: payment.stripeChargeId ?? undefined,
    metadata: {
      payoutId: payout._id.toString(),
      orderId: payment.order.toString(),
      paymentId: payment._id.toString(),
      storeId: payout.store.toString(),
    },
  });

  payout.stripePayoutId = transfer.id;
  payout.status = "paid";
  payout.payday = new Date();
  payout.failureMessage = null;
  await payout.save();
};

const dispatchPendingPayoutTransfersForOrder = async ({ orderId, paymentId }) => {
  const stripe = getStripeClientOrThrow();
  const subOrderIds = await SubOrder.find({ order: orderId }).distinct("_id");

  const [payment, payouts] = await Promise.all([
    Payment.findById(paymentId).select("_id order stripeChargeId"),
    Payout.find({ status: "pending" }).where("subOrders").in(subOrderIds),
  ]);

  if (!payment || payouts.length === 0) return;

  for (const payout of payouts) {
    try {
      await tryDispatchPayoutTransfer({ payout, payment, stripe });
    } catch (error) {
      payout.status = "failed";
      payout.failureMessage = error?.message ?? "Falha ao transferir fundos para a loja";
      await payout.save();
    }
  }
};

export const dispatchPendingPayoutTransfersForStore = async (storeId) => {
  const stripe = getStripeClientOrThrow();
  const payouts = await Payout.find({ store: storeId, status: "pending" }).sort({ createdAt: 1 });

  for (const payout of payouts) {
    const subOrder = await SubOrder.findOne({ _id: { $in: payout.subOrders } })
      .select("order")
      .lean();
    if (!subOrder) continue;

    const payment = await resolvePrimaryPaymentAttemptForOrder(subOrder.order);
    if (!payment || !payment.stripeChargeId) continue;

    try {
      await tryDispatchPayoutTransfer({ payout, payment, stripe });
    } catch (error) {
      payout.status = "failed";
      payout.failureMessage = error?.message ?? "Falha ao transferir fundos para a loja";
      await payout.save();
    }
  }
};

const markPaymentAsSucceededByIntentId = async ({ stripePaymentIntent, stripeEventId, metadata = {} }) => {
  const stripePaymentIntentId = stripePaymentIntent.id;
  const session = await mongoose.startSession();
  let orderIdForPayout = null;
  let paymentIdForPayout = null;
  let orderIdForNotification = null;

  try {
    await session.withTransaction(async () => {
      const payment = await resolvePaymentFromStripeEvent({
        session,
        stripePaymentIntentId,
        paymentId: metadata.paymentId,
      });
      if (!payment) {
        throw createHttpError(
          "Pagamento ainda não registrado para esse evento",
          409,
          { stripePaymentIntentId, stripeEventId },
          "CHECKOUT_WEBHOOK_PAYMENT_NOT_READY",
        );
      }

      if (isEventAlreadyProcessed(payment, stripeEventId)) return;

      if (!payment.stripePaymentIntentId) {
        payment.stripePaymentIntentId = stripePaymentIntentId;
      }

      if (payment.status === "succeeded") {
        const order = await Order.findById(payment.order).session(session);
        if (order && order.status !== "paid") {
          order.status = "paid";
          await order.save({ session });

          await SubOrder.updateMany({ order: order._id, status: { $ne: "paid" } }, { $set: { status: "paid" } }, {
            session,
          });

          orderIdForNotification = order._id;
        }

        appendPaymentEvent({
          payment,
          stripeEventId,
          type: "payment_intent.succeeded",
          metadata: { duplicate: true },
        });
        await payment.save({ session });
        return;
      }

      const order = await Order.findById(payment.order).session(session);
      if (!order) return;

      const subOrders = await SubOrder.find({ order: order._id }).session(session);

      const variantRequirements = [];
      for (const subOrder of subOrders) {
        for (const item of subOrder.items ?? []) {
          variantRequirements.push({
            productVariantId: item.productVariantId.toString(),
            quantity: Number(item.quantity),
          });
        }
      }

      if (variantRequirements.length > 0) {
        const variantIds = variantRequirements.map((item) => item.productVariantId);
        const variants = await ProductVariant.find({ _id: { $in: variantIds } })
          .session(session)
          .select("stock")
          .lean();
        const stockByVariant = new Map(variants.map((variant) => [variant._id.toString(), Number(variant.stock)]));

        const hasInsufficientStock = variantRequirements.some(
          (requiredItem) => requiredItem.quantity > (stockByVariant.get(requiredItem.productVariantId) ?? 0),
        );

        if (hasInsufficientStock) {
          payment.status = "failed";
          appendPaymentEvent({
            payment,
            stripeEventId,
            type: "payment_intent.succeeded",
            metadata: { stockConflict: true },
          });
          await payment.save({ session });

          order.status = "failed";
          await order.save({ session });
          await SubOrder.updateMany(
            { order: order._id, status: { $in: ["pending", "processing"] } },
            { $set: { status: "failed" } },
            { session },
          );
          return;
        }
      }

      const stockUpdates = [];
      for (const subOrder of subOrders) {
        for (const item of subOrder.items ?? []) {
          stockUpdates.push({
            updateOne: {
              filter: { _id: item.productVariantId, stock: { $gte: Number(item.quantity) } },
              update: { $inc: { stock: -Number(item.quantity) } },
            },
          });
        }
      }

      if (stockUpdates.length > 0) {
        const stockUpdateResult = await ProductVariant.bulkWrite(stockUpdates, { session, ordered: true });

        if (Number(stockUpdateResult.modifiedCount) !== stockUpdates.length) {
          throw createHttpError(
            "Estoque insuficiente ao confirmar pagamento",
            409,
            {
              expectedUpdates: stockUpdates.length,
              appliedUpdates: Number(stockUpdateResult.modifiedCount),
            },
            "CHECKOUT_WEBHOOK_STOCK_CONFLICT",
          );
        }
      }

      const couponSnapshot = subOrders.find((subOrder) => subOrder.coupon?.couponId)?.coupon;
      await consumeCouponIfNeeded({
        session,
        couponSnapshot,
        orderId: order._id,
        userId: order.user,
      });

      await Cart.updateOne(
        { user: order.user },
        {
          $set: {
            items: [],
            appliedCoupon: {
              couponId: null,
              code: null,
              discountType: null,
              discountValue: null,
            },
          },
        },
        { session },
      );

      order.status = "paid";
      await order.save({ session });

      await SubOrder.updateMany({ order: order._id, status: "pending" }, { $set: { status: "paid" } }, { session });

      const payoutByStore = new Map();
      for (const subOrder of subOrders) {
        const key = subOrder.store.toString();
        const amount = Number(subOrder.vendorNetAmount ?? 0);

        if (!payoutByStore.has(key)) {
          payoutByStore.set(key, {
            store: subOrder.store,
            subOrders: [],
            amount: 0,
          });
        }

        const target = payoutByStore.get(key);
        target.subOrders.push(subOrder._id);
        target.amount = roundMoney(target.amount + amount);
      }

      if (payoutByStore.size > 0) {
        await Payout.insertMany(
          Array.from(payoutByStore.values()).map((entry) => ({
            store: entry.store,
            subOrders: entry.subOrders,
            amount: entry.amount,
            status: "pending",
          })),
          { session },
        );
      }

      orderIdForPayout = order._id;
      paymentIdForPayout = payment._id;
      orderIdForNotification = order._id;

      payment.status = "succeeded";
      payment.paidAt = new Date();
      payment.stripeChargeId =
        typeof stripePaymentIntent.latest_charge === "string"
          ? stripePaymentIntent.latest_charge
          : payment.stripeChargeId;

      appendPaymentEvent({
        payment,
        stripeEventId,
        type: "payment_intent.succeeded",
        metadata: {
          amountReceived: stripePaymentIntent.amount_received,
          currency: stripePaymentIntent.currency,
        },
      });

      await payment.save({ session });
    });

    if (orderIdForPayout && paymentIdForPayout) {
      await dispatchPendingPayoutTransfersForOrder({
        orderId: orderIdForPayout,
        paymentId: paymentIdForPayout,
      });
    }

    if (orderIdForNotification) {
      await notifyOrderPaid(orderIdForNotification);
    }
  } finally {
    await session.endSession();
  }
};

const markPaymentAsRefundedByChargeId = async ({ stripeChargeId, amountRefundedInCents, stripeEventId }) => {
  const session = await mongoose.startSession();
  let notificationPayload = null;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({ stripeChargeId }).session(session);
      if (!payment) return;

      if (isEventAlreadyProcessed(payment, stripeEventId)) return;

      const refundedAmount = Number(amountRefundedInCents ?? 0) / 100;
      const totalAmount = Number(payment.amount ?? 0);
      const isTotalRefund = refundedAmount >= totalAmount;

      payment.refundedAmount = refundedAmount;
      payment.status = isTotalRefund ? "refunded" : "partially_refunded";

      appendPaymentEvent({
        payment,
        stripeEventId,
        type: "charge.refunded",
        metadata: { refundedAmount },
      });

      await payment.save({ session });

      const [order, subOrders] = await Promise.all([
        Order.findById(payment.order).select("_id user").session(session).lean(),
        SubOrder.find({ order: payment.order }).select("store").session(session).lean(),
      ]);

      if (!order) return;

      const stores = await Store.find({ _id: { $in: subOrders.map((subOrder) => subOrder.store) } })
        .select("owner")
        .session(session)
        .lean();

      notificationPayload = {
        orderId: order._id,
        userId: order.user,
        sellerIds: stores.map((store) => store.owner),
      };
    });

    if (notificationPayload) {
      await notifyRefundEvent(notificationPayload);
    }
  } finally {
    await session.endSession();
  }
};

const syncPayoutStatusFromStripeEvent = async ({ connectedAccountId, payoutObject, eventType }) => {
  if (!connectedAccountId || !payoutObject?.id) return;

  const store = await Store.findOne({ stripeConnectId: connectedAccountId }).select("_id").lean();
  if (!store) return;

  let payout = await Payout.findOne({ stripePayoutId: payoutObject.id });

  if (!payout) {
    payout = await Payout.findOne({ store: store._id, status: { $in: ["pending", "in_transit"] } }).sort({
      createdAt: 1,
    });
    if (!payout) return;

    payout.stripePayoutId = payoutObject.id;
  }

  if (eventType === "payout.paid") {
    payout.status = "paid";
    payout.payday = payoutObject.arrival_date ? new Date(payoutObject.arrival_date * 1000) : new Date();
  }

  if (eventType === "payout.failed") {
    payout.status = "failed";
    payout.failureMessage = payoutObject.failure_message ?? "Payout falhou no Stripe";
  }

  if (eventType === "payout.canceled") {
    payout.status = "cancelled";
  }

  if (eventType === "payout.created") {
    payout.status = "in_transit";
  }

  await payout.save();
};

export const processStripeWebhookEvent = async ({ payloadBuffer, signature }) => {
  const event = buildStripeWebhookEventOrThrow(payloadBuffer, signature);

  switch (event.type) {
    case "payment_intent.succeeded": {
      await markPaymentAsSucceededByIntentId({
        stripePaymentIntent: event.data.object,
        stripeEventId: event.id,
        metadata: event.data.object.metadata ?? {},
      });
      break;
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
    case "payment_intent.requires_action": {
      await markPaymentAsFailedByIntentId({
        stripePaymentIntentId: event.data.object.id,
        stripeEventId: event.id,
        eventType: event.type,
        metadata: {
          paymentId: event.data.object.metadata?.paymentId ?? null,
          lastPaymentErrorCode: event.data.object.last_payment_error?.code ?? null,
        },
      });
      break;
    }
    case "charge.refunded": {
      await markPaymentAsRefundedByChargeId({
        stripeChargeId: event.data.object.id,
        amountRefundedInCents: event.data.object.amount_refunded,
        stripeEventId: event.id,
      });
      break;
    }
    case "payout.created":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled": {
      await syncPayoutStatusFromStripeEvent({
        connectedAccountId: event.account,
        payoutObject: event.data.object,
        eventType: event.type,
      });
      break;
    }
    default:
      break;
  }

  return {
    received: true,
    eventId: event.id,
    eventType: event.type,
  };
};
