import mongoose from "mongoose";
import Stripe from "stripe";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import ProductVariant from "../models/productVariant.model.js";
import Address from "../models/address.model.js";
import PaymentMethod from "../models/paymentMethod.model.js";
import Payment from "../models/payment.model.js";
import Coupon from "../models/coupon.model.js";
import CouponUsage from "../models/couponUsage.model.js";
import { createHttpError } from "../helpers/httpError.js";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const CHECKOUT_EVENT_SOURCE = "stripe_webhook";

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

const validateCouponByContextOrThrow = async ({ couponCode, subTotal, items, userId }) => {
  if (!couponCode) {
    return {
      coupon: null,
      discountAmount: 0,
      eligibleItemKeys: new Set(),
    };
  }

  const coupon = await Coupon.findOne({ code: couponCode, status: { $in: ["active", "sold-out"] } });

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
  });
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

const buildSubOrders = ({ orderId, groupedByStore, totalDiscount, coupon, eligibleItemKeys }) => {
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

    const shippingCost = 0;
    const platformFee = 0;
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

const normalizeCartForCheckoutOrThrow = async (userId) => {
  const cart = await Cart.findOne({ user: userId }).populate({
    path: "items.productVariant",
    select: "price stock sku imageUrl product",
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
    });
    storeGroup.subTotal = roundMoney(storeGroup.subTotal + normalizedItem.unitPrice * normalizedItem.quantity);
  }

  return { cart, normalizedItems, groupedByStore };
};

export const createCheckoutIntentForUser = async (userId, payload) => {
  const { addressId, paymentMethodId, couponCode } = payload;

  const [address, paymentMethod, cartContext] = await Promise.all([
    Address.findOne({ _id: addressId, user: userId }),
    PaymentMethod.findOne({ _id: paymentMethodId, user: userId }),
    normalizeCartForCheckoutOrThrow(userId),
  ]);

  if (!address) {
    throw createHttpError("Endereço não encontrado", 404, undefined, "CHECKOUT_ADDRESS_NOT_FOUND");
  }

  if (!paymentMethod) {
    throw createHttpError("Método de pagamento não encontrado", 404, undefined, "CHECKOUT_PAYMENT_METHOD_NOT_FOUND");
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

  const totalDiscount = couponContext.discountAmount;
  const totalShippingPrice = 0;
  const totalPaidByCustomer = roundMoney(subTotal - totalDiscount + totalShippingPrice);

  const session = await mongoose.startSession();

  let order;
  let payment;
  let subOrders;

  try {
    await session.withTransaction(async () => {
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
      });

      subOrders = await SubOrder.insertMany(subOrderPayload, { session });

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
            status: "pending",
            events: [
              {
                type: "checkout_intent_created",
                at: new Date(),
                metadata: {
                  paymentMethodId: paymentMethod._id.toString(),
                  couponCode: couponContext.coupon?.code ?? null,
                },
              },
            ],
          },
        ],
        { session },
      );
    });

    const stripeIntent = await getStripeClientOrThrow().paymentIntents.create({
      amount: Math.round(totalPaidByCustomer * 100),
      currency: "brl",
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order._id.toString(),
        paymentId: payment._id.toString(),
        userId: userId.toString(),
      },
    });

    payment.stripePaymentIntentId = stripeIntent.id;
    await payment.save();

    order.stripePaymentId = stripeIntent.id;
    await order.save();

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

const markPaymentAsFailedByIntentId = async ({ stripePaymentIntentId, stripeEventId, eventType, metadata = {} }) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({ stripePaymentIntentId }).session(session);
      if (!payment) return;

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
      }
    });
  } finally {
    await session.endSession();
  }
};

const markPaymentAsSucceededByIntentId = async ({ stripePaymentIntent, stripeEventId }) => {
  const stripePaymentIntentId = stripePaymentIntent.id;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({ stripePaymentIntentId }).session(session);
      if (!payment) return;

      if (isEventAlreadyProcessed(payment, stripeEventId)) return;

      if (payment.status === "succeeded") {
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

      for (const subOrder of subOrders) {
        for (const item of subOrder.items ?? []) {
          const updated = await ProductVariant.updateOne(
            { _id: item.productVariantId, stock: { $gte: Number(item.quantity) } },
            { $inc: { stock: -Number(item.quantity) } },
            { session },
          );

          if (!updated.modifiedCount) {
            throw createHttpError(
              "Estoque insuficiente ao confirmar pagamento",
              409,
              {
                productVariantId: item.productVariantId,
                quantity: item.quantity,
              },
              "CHECKOUT_WEBHOOK_STOCK_CONFLICT",
            );
          }
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
  } finally {
    await session.endSession();
  }
};

export const processStripeWebhookEvent = async ({ payloadBuffer, signature }) => {
  const event = buildStripeWebhookEventOrThrow(payloadBuffer, signature);

  switch (event.type) {
    case "payment_intent.succeeded": {
      await markPaymentAsSucceededByIntentId({
        stripePaymentIntent: event.data.object,
        stripeEventId: event.id,
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
          lastPaymentErrorCode: event.data.object.last_payment_error?.code ?? null,
        },
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
