import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import { createHttpError } from "../helpers/httpError.js";

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
  const paymentByOrderId = new Map(
    payments
      .map((payment) => [payment.order?.toString?.(), payment])
      .filter(([orderId]) => Boolean(orderId)),
  );

  return orders.map((order) => {
    const orderId = order._id.toString();

    return {
      ...order,
      subOrders: subOrdersByOrderId.get(orderId) ?? [],
      payment: paymentByOrderId.get(orderId) ?? null,
    };
  });
};

export const listOrdersForUser = async (userId, { page = 1, limit = 20, status } = {}) => {
  const filters = { user: userId };

  if (status) {
    filters.status = status;
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(filters)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
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
      .select("order status amount currency paymentMethod paidAt refundedAmount")
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

  const [subOrders, payment] = await Promise.all([
    SubOrder.find({ order: order._id })
      .sort({ createdAt: 1 })
      .select("order store items coupon subTotal shippingCost discountAmount vendorNetAmount status")
      .populate("store", "name slug logoUrl status")
      .lean(),
    Payment.findOne({ order: order._id })
      .select("status amount currency paymentMethod paidAt refundedAmount events")
      .lean(),
  ]);

  return {
    ...order,
    subOrders,
    payment: payment ?? null,
  };
};
