import mongoose from "mongoose";
import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Shipping from "../models/shipping.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { findActiveStoreByOwnerOrThrow } from "./catalog.service.js";
import { findSellerOrderByIdOrThrow } from "./storeOrder.service.js";
import { notifyOrderStatusForCustomer } from "./notification.service.js";

const SELLER_STATUS_FLOW = {
  pending: [],
  paid: ["processing"],
  processing: ["shipping"],
  shipping: ["delivered"],
  delivered: [],
  cancelled: [],
  failed: [],
};

const ORDER_PAID_LIKE_STATUSES = new Set(["paid", "processing", "shipping", "delivered"]);

const ensureValidSellerStatusTransitionOrThrow = async (currentStatus, nextStatus, subOrderId) => {
  if (currentStatus === "pending") {
    throw createHttpError(
      "O pagamento ainda não foi confirmado para iniciar a operação do pedido",
      409,
      { currentStatus, requestedStatus: nextStatus },
      "SELLER_SUBORDER_PAYMENT_NOT_CONFIRMED",
    );
  }

  if (currentStatus === nextStatus) {
    throw createHttpError(
      "O pedido já está neste status",
      409,
      { currentStatus, requestedStatus: nextStatus },
      "SELLER_SUBORDER_STATUS_ALREADY_SET",
    );
  }

  const allowedStatuses = SELLER_STATUS_FLOW[currentStatus] ?? [];

  if (!allowedStatuses.includes(nextStatus)) {
    throw createHttpError(
      "Transição de status inválida para este pedido",
      409,
      { currentStatus, requestedStatus: nextStatus, allowedStatuses },
      "SELLER_SUBORDER_STATUS_TRANSITION_FORBIDDEN",
    );
  }

  // Validação adicional: para transicionar para "shipping", etiqueta deve existir
  if (nextStatus === "shipping") {
    const shipping = await Shipping.findOne({
      subOrder: subOrderId,
      status: { $in: ["posted", "in_transit"] },
    });

    if (!shipping) {
      throw createHttpError(
        "Etiqueta de envio não foi gerada. Gere a etiqueta antes de transicionar para 'shipping'",
        409,
        { subOrderId, nextStatus },
        "SELLER_SHIPPING_LABEL_NOT_GENERATED",
      );
    }
  }
};

const deriveOrderStatusFromSubOrders = (subOrderStatuses = []) => {
  if (subOrderStatuses.length === 0) {
    return null;
  }

  if (subOrderStatuses.every((status) => status === "cancelled")) {
    return "cancelled";
  }

  if (subOrderStatuses.every((status) => status === "failed")) {
    return "failed";
  }

  if (subOrderStatuses.some((status) => ORDER_PAID_LIKE_STATUSES.has(status))) {
    return "paid";
  }

  if (subOrderStatuses.every((status) => status === "pending")) {
    return "pending";
  }

  return null;
};

const syncParentOrderStatusFromSubOrders = async ({ orderId, session }) => {
  const subOrders = await SubOrder.find({ order: orderId }).select("status").session(session).lean();
  const nextOrderStatus = deriveOrderStatusFromSubOrders(subOrders.map((subOrder) => subOrder.status));

  if (!nextOrderStatus) {
    return;
  }

  await Order.updateOne(
    { _id: orderId, status: { $ne: nextOrderStatus } },
    {
      $set: {
        status: nextOrderStatus,
      },
    },
    { session },
  );
};

export const updateSellerOrderStatus = async (ownerId, orderId, { status }) => {
  const store = await findActiveStoreByOwnerOrThrow(ownerId);
  const session = await mongoose.startSession();
  let targetOrderUserId = null;

  try {
    await session.withTransaction(async () => {
      const subOrder = await SubOrder.findOne({ order: orderId, store: store._id }).select("_id status").session(session).lean();

      if (!subOrder) {
        throw createHttpError("Pedido não encontrado", 404, undefined, "SELLER_ORDER_NOT_FOUND");
      }

      const order = await Order.findById(orderId).select("_id user").session(session).lean();
      targetOrderUserId = order?.user ?? null;

      await ensureValidSellerStatusTransitionOrThrow(subOrder.status, status, subOrder._id);

      const updatedSubOrder = await SubOrder.updateOne(
        { _id: subOrder._id, status: subOrder.status },
        {
          $set: {
            status,
          },
        },
        { session },
      );

      if (updatedSubOrder.matchedCount === 0) {
        throw createHttpError(
          "Conflito de atualização. Tente novamente.",
          409,
          { orderId, subOrderId: subOrder._id },
          "SELLER_SUBORDER_CONCURRENT_UPDATE_CONFLICT",
        );
      }

      await syncParentOrderStatusFromSubOrders({ orderId, session });
    });
  } finally {
    await session.endSession();
  }

  if (targetOrderUserId) {
    await notifyOrderStatusForCustomer({
      orderId,
      userId: targetOrderUserId,
      status,
    });
  }

  return findSellerOrderByIdOrThrow(ownerId, orderId);
};