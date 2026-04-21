import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import { createHttpError } from "../helpers/httpError.js";
import {
  buildPaginationResult,
  buildPaymentView,
  groupByOrderId,
} from "./orderView.helper.js";

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
      filters.createdAt.$lte = createdTo;
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
