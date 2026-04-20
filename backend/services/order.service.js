import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import { createHttpError } from "../helpers/httpError.js";

const PAYMENT_STATUS_PRIORITY = {
  succeeded: 600,
  partially_refunded: 500,
  refunded: 400,
  requires_action: 300,
  pending: 200,
  failed: 100,
};

const getPaymentStatusPriority = (status) => PAYMENT_STATUS_PRIORITY[status] ?? 0;

const getTimestamp = (value) => {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  const timestamp = date ? date.getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeCreatedTo = (createdTo) => {
  if (!createdTo) return undefined;

  const normalizedDate = new Date(createdTo);
  if (!Number.isFinite(normalizedDate.getTime())) {
    return createdTo;
  }

  // If only a date was provided and time is midnight, include the full day window.
  if (
    normalizedDate.getHours() === 0 &&
    normalizedDate.getMinutes() === 0 &&
    normalizedDate.getSeconds() === 0 &&
    normalizedDate.getMilliseconds() === 0
  ) {
    normalizedDate.setHours(23, 59, 59, 999);
  }

  return normalizedDate;
};

const sortPaymentAttempts = (payments = []) => {
  return [...payments].sort((a, b) => {
    const byPriority = getPaymentStatusPriority(b.status) - getPaymentStatusPriority(a.status);
    if (byPriority !== 0) return byPriority;

    const byPaidAt = getTimestamp(b.paidAt) - getTimestamp(a.paidAt);
    if (byPaidAt !== 0) return byPaidAt;

    const byCreatedAt = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;

    return getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt);
  });
};

const formatPaymentAttempt = (payment = {}) => ({
  id: payment._id,
  order: payment.order,
  status: payment.status,
  amount: payment.amount,
  currency: payment.currency,
  paymentMethod: payment.paymentMethod,
  paidAt: payment.paidAt,
  refundedAmount: payment.refundedAmount,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
  stripePaymentIntentId: payment.stripePaymentIntentId,
  stripeChargeId: payment.stripeChargeId,
});

const buildPaymentView = (payments = []) => {
  const orderedAttempts = sortPaymentAttempts(payments);
  const paymentAttempts = orderedAttempts.map((attempt) => formatPaymentAttempt(attempt));
  const paymentCurrent = paymentAttempts[0] ?? null;

  return {
    paymentCurrent,
    paymentAttempts,
    payment: paymentCurrent, // backward compatibility for current frontend consumers
  };
};

const buildPaginationResult = (items, total, page, limit) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  },
});

const groupByOrderId = (items = [], orderField = "order") => {
  const groupedItems = new Map();

  for (const item of items) {
    const orderId = item?.[orderField]?.toString?.();
    if (!orderId) continue;

    const currentItems = groupedItems.get(orderId) ?? [];
    currentItems.push(item);
    groupedItems.set(orderId, currentItems);
  }

  return groupedItems;
};

const attachOrderRelations = ({ orders, subOrders, payments }) => {
  const subOrdersByOrderId = groupByOrderId(subOrders);
  const paymentsByOrderId = groupByOrderId(payments);

  return orders.map((order) => {
    const orderId = order._id.toString();
    const paymentView = buildPaymentView(paymentsByOrderId.get(orderId) ?? []);

    return {
      ...order,
      subOrders: subOrdersByOrderId.get(orderId) ?? [],
      ...paymentView,
    };
  });
};

export const listOrdersForUser = async (
  userId,
  { page = 1, limit = 20, status, createdFrom, createdTo, sort = "newest" } = {},
) => {
  const filters = { user: userId };

  if (status) {
    filters.status = status;
  }

  if (createdFrom || createdTo) {
    filters.createdAt = {};

    if (createdFrom) {
      filters.createdAt.$gte = createdFrom;
    }

    if (createdTo) {
      filters.createdAt.$lte = normalizeCreatedTo(createdTo);
    }
  }

  const sortByCreatedAt = sort === "oldest" ? 1 : -1;

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(filters).sort({ createdAt: sortByCreatedAt }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filters),
  ]);

  if (orders.length === 0) {
    return buildPaginationResult([], total, page, limit);
  }

  const orderIds = orders.map((order) => order._id);

  const [subOrders, payments] = await Promise.all([
    SubOrder.find({ order: { $in: orderIds } })
      .sort({ createdAt: 1 })
      .select("order store items subTotal shippingCost discountAmount vendorNetAmount status")
      .populate("store", "name slug logoUrl status")
      .lean(),
    Payment.find({ order: { $in: orderIds } })
      .select(
        "order status amount currency paymentMethod paidAt refundedAmount createdAt updatedAt stripePaymentIntentId stripeChargeId",
      )
      .lean(),
  ]);

  const items = attachOrderRelations({ orders, subOrders, payments });

  return buildPaginationResult(items, total, page, limit);
};

export const findOrderByIdForUserOrThrow = async (orderId, userId) => {
  const order = await Order.findOne({ _id: orderId, user: userId }).lean();

  if (!order) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "ORDER_NOT_FOUND");
  }

  const [subOrders, payments] = await Promise.all([
    SubOrder.find({ order: order._id })
      .sort({ createdAt: 1 })
      .select("order store items coupon subTotal shippingCost discountAmount vendorNetAmount status")
      .populate("store", "name slug logoUrl status")
      .lean(),
    Payment.find({ order: order._id })
      .select(
        "order status amount currency paymentMethod paidAt refundedAmount createdAt updatedAt stripePaymentIntentId stripeChargeId",
      )
      .lean(),
  ]);

  const paymentView = buildPaymentView(payments);

  return {
    ...order,
    subOrders,
    ...paymentView,
  };
};
