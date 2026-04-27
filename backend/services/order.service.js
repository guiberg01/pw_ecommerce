import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { reconcileCheckoutOrderPaymentForUser } from "./checkout.service.js";
import { buildPaginationResult, buildPaymentView, groupByOrderId } from "../helpers/orderView.helper.js";
import { orderStatuses } from "../constants/orderStatuses.js";

const tryAutoReconcilePendingOrderPayment = async ({ orderId, userId, status }) => {
  if (status !== orderStatuses.PENDING) {
    return false;
  }

  try {
    await reconcileCheckoutOrderPaymentForUser(userId, orderId);
    return true;
  } catch (error) {
    // Reconciliação é fallback: erros não devem bloquear a consulta do pedido.
    console.warn(
      `[Order] Falha ao reconciliar pagamento pendente (orderId=${orderId}, userId=${userId}): ${error?.message ?? "erro desconhecido"}`,
    );
    return false;
  }
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

  const pendingOrders = orders.filter((order) => order.status === orderStatuses.PENDING);
  if (pendingOrders.length > 0) {
    await Promise.allSettled(
      pendingOrders.map((order) =>
        tryAutoReconcilePendingOrderPayment({
          orderId: order._id,
          userId,
          status: order.status,
        }),
      ),
    );

    const refreshedOrders = await Order.find({ _id: { $in: orders.map((order) => order._id) } }).lean();
    const refreshedById = new Map(refreshedOrders.map((order) => [order._id.toString(), order]));
    for (let index = 0; index < orders.length; index += 1) {
      const refreshed = refreshedById.get(orders[index]._id.toString());
      if (refreshed) {
        orders[index] = refreshed;
      }
    }
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
  let order = await Order.findOne({ _id: orderId, user: userId }).lean();

  if (!order) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "ORDER_NOT_FOUND");
  }

  await tryAutoReconcilePendingOrderPayment({
    orderId: order._id,
    userId,
    status: order.status,
  });

  order = (await Order.findOne({ _id: orderId, user: userId }).lean()) ?? order;

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
