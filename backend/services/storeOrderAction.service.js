import SubOrder from "../models/subOrder.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { findActiveStoreByOwnerOrThrow } from "./catalog.service.js";
import { findSellerOrderByIdOrThrow } from "./storeOrder.service.js";

const SELLER_STATUS_FLOW = {
  pending: ["processing"],
  paid: ["processing"],
  processing: ["shipping"],
  shipping: ["delivered"],
  delivered: [],
  cancelled: [],
  failed: [],
};

const ensureValidSellerStatusTransitionOrThrow = (currentStatus, nextStatus) => {
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
};

export const updateSellerOrderStatus = async (ownerId, orderId, { status }) => {
  const store = await findActiveStoreByOwnerOrThrow(ownerId);
  const subOrder = await SubOrder.findOne({ order: orderId, store: store._id }).select("_id status").lean();

  if (!subOrder) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "SELLER_ORDER_NOT_FOUND");
  }

  ensureValidSellerStatusTransitionOrThrow(subOrder.status, status);

  await SubOrder.updateOne(
    { _id: subOrder._id },
    {
      $set: {
        status,
      },
    },
  );

  return findSellerOrderByIdOrThrow(ownerId, orderId);
};