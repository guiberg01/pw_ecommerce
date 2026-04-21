import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { findActiveStoreByOwnerOrThrow } from "./catalog.service.js";
import { buildPaginationResult, buildPaymentView, groupByOrderId } from "./orderView.helper.js";

const ORDER_SELECT_FIELDS =
  "user status totalPriceProducts totalPaidByCustomer totalShippingPrice totalDiscount shippingAddress createdAt updatedAt";

const SUB_ORDER_SELECT_FIELDS =
  "order store items coupon subTotal shippingCost discountAmount platformFee vendorNetAmount status createdAt updatedAt";

const PAYMENT_SELECT_FIELDS =
  "order status amount currency paymentMethod paidAt refundedAmount createdAt updatedAt";

const sortDirectionFromValue = (sort = "newest") => (sort === "oldest" ? 1 : -1);

const buildOrderFilters = ({ orderStatus, createdFrom, createdTo }) => {
  const filters = {};

  if (orderStatus) {
    filters.status = orderStatus;
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

  return filters;
};

const buildSellerOrderSummary = (orders = [], subOrders = []) => {
  const subOrdersByOrderId = groupByOrderId(subOrders);

  return orders.reduce(
    (summary, order) => {
      const orderId = order._id.toString();
      const sellerSubOrder = subOrdersByOrderId.get(orderId)?.[0];

      if (!sellerSubOrder) {
        return summary;
      }

      summary.orderCount += 1;
      summary.grossRevenue += Number(sellerSubOrder.subTotal ?? 0);
      summary.netRevenue += Number(sellerSubOrder.vendorNetAmount ?? 0);
      summary.discountTotal += Number(sellerSubOrder.discountAmount ?? 0);
      summary.shippingTotal += Number(sellerSubOrder.shippingCost ?? 0);
      summary.itemsCount += (sellerSubOrder.items ?? []).reduce((count, item) => count + Number(item.quantity ?? 0), 0);
      summary.statusBreakdown[sellerSubOrder.status] = (summary.statusBreakdown[sellerSubOrder.status] ?? 0) + 1;

      return summary;
    },
    {
      orderCount: 0,
      grossRevenue: 0,
      netRevenue: 0,
      discountTotal: 0,
      shippingTotal: 0,
      itemsCount: 0,
      statusBreakdown: {
        pending: 0,
        paid: 0,
        processing: 0,
        shipping: 0,
        delivered: 0,
        cancelled: 0,
        failed: 0,
      },
    },
  );
};

const buildSellerOrderItem = ({ order, subOrder, paymentView }) => ({
  id: order._id,
  order: {
    id: order._id,
    status: order.status,
    totalPriceProducts: order.totalPriceProducts,
    totalPaidByCustomer: order.totalPaidByCustomer,
    totalShippingPrice: order.totalShippingPrice,
    totalDiscount: order.totalDiscount,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  },
  customer: {
    id: order.user?._id ?? order.user ?? null,
    name: order.user?.name ?? null,
  },
  subOrder: {
    id: subOrder._id,
    items: subOrder.items,
    coupon: subOrder.coupon ?? null,
    subTotal: subOrder.subTotal,
    shippingCost: subOrder.shippingCost,
    discountAmount: subOrder.discountAmount,
    platformFee: subOrder.platformFee,
    vendorNetAmount: subOrder.vendorNetAmount,
    status: subOrder.status,
    createdAt: subOrder.createdAt,
    updatedAt: subOrder.updatedAt,
    store: subOrder.store,
  },
  paymentCurrent: paymentView.paymentCurrent,
  paymentAttempts: paymentView.paymentAttempts,
  payment: paymentView.payment,
});

const resolveSellerOrdersOrThrow = async (storeId, sellerOrderIds) => {
  if (sellerOrderIds.length === 0) {
    return [];
  }

  const orderMap = new Map();

  const orders = await Order.find({ _id: { $in: sellerOrderIds } })
    .populate("user", "name")
    .select(ORDER_SELECT_FIELDS)
    .lean();

  for (const order of orders) {
    orderMap.set(order._id.toString(), order);
  }

  const subOrders = await SubOrder.find({ order: { $in: sellerOrderIds }, store: storeId })
    .select(SUB_ORDER_SELECT_FIELDS)
    .lean();

  const subOrdersByOrderId = groupByOrderId(subOrders);

  return sellerOrderIds
    .map((orderId) => {
      const order = orderMap.get(orderId.toString());
      const sellerSubOrder = subOrdersByOrderId.get(orderId.toString())?.[0];

      if (!order || !sellerSubOrder) {
        return null;
      }

      return { order, sellerSubOrder };
    })
    .filter(Boolean);
};

export const listOrdersForSeller = async (
  ownerId,
  { page = 1, limit = 20, orderStatus, subOrderStatus, createdFrom, createdTo, sort = "newest" } = {},
) => {
  const store = await findActiveStoreByOwnerOrThrow(ownerId);
  const orderFilters = buildOrderFilters({ orderStatus, createdFrom, createdTo });
  const sortDirection = sortDirectionFromValue(sort);
  const skip = (page - 1) * limit;

  const candidateOrderIds = await Order.distinct("_id", orderFilters);

  if (candidateOrderIds.length === 0) {
    return buildPaginationResult([], 0, page, limit, {
      summary: buildSellerOrderSummary([], []),
    });
  }

  const subOrderFilters = {
    store: store._id,
    order: { $in: candidateOrderIds },
  };

  if (subOrderStatus) {
    subOrderFilters.status = subOrderStatus;
  }

  const sellerOrderIds = await SubOrder.distinct("order", subOrderFilters);

  if (sellerOrderIds.length === 0) {
    return buildPaginationResult([], 0, page, limit, {
      summary: buildSellerOrderSummary([], []),
    });
  }

  const [pagedOrders, summaryRows, payments] = await Promise.all([
    Order.find({ _id: { $in: sellerOrderIds } })
      .populate("user", "name")
      .select(ORDER_SELECT_FIELDS)
      .sort({ createdAt: sortDirection })
      .skip(skip)
      .limit(limit)
      .lean(),
    resolveSellerOrdersOrThrow(store._id, sellerOrderIds),
    Payment.find({ order: { $in: sellerOrderIds } })
      .select(PAYMENT_SELECT_FIELDS)
      .lean(),
  ]);

  const total = sellerOrderIds.length;

  if (pagedOrders.length === 0) {
    return buildPaginationResult([], total, page, limit, {
      summary: buildSellerOrderSummary(summaryRows.map((row) => row.order), summaryRows.map((row) => row.sellerSubOrder)),
    });
  }

  const summaryMap = new Map(summaryRows.map((row) => [row.order._id.toString(), row]));
  const paymentsByOrderId = groupByOrderId(payments);

  const items = pagedOrders.map((order) => {
    const record = summaryMap.get(order._id.toString());

    if (!record) {
      throw createHttpError("Pedido do seller não encontrado", 404, undefined, "SELLER_ORDER_NOT_FOUND");
    }

    const paymentView = buildPaymentView(paymentsByOrderId.get(order._id.toString()) ?? [], {
      includeGatewayIds: false,
    });

    return buildSellerOrderItem({
      order,
      subOrder: record.sellerSubOrder,
      paymentView,
    });
  });

  return buildPaginationResult(items, total, page, limit, {
    summary: buildSellerOrderSummary(summaryRows.map((row) => row.order), summaryRows.map((row) => row.sellerSubOrder)),
  });
};

export const findSellerOrderByIdOrThrow = async (ownerId, orderId) => {
  const store = await findActiveStoreByOwnerOrThrow(ownerId);

  const [order, subOrder, payments] = await Promise.all([
    Order.findById(orderId).populate("user", "name").select(ORDER_SELECT_FIELDS).lean(),
    SubOrder.findOne({ order: orderId, store: store._id }).select(SUB_ORDER_SELECT_FIELDS).lean(),
    Payment.find({ order: orderId }).select(PAYMENT_SELECT_FIELDS).lean(),
  ]);

  if (!order || !subOrder) {
    throw createHttpError("Pedido não encontrado", 404, undefined, "SELLER_ORDER_NOT_FOUND");
  }

  const paymentView = buildPaymentView(payments, { includeGatewayIds: false });

  return {
    id: order._id,
    order: {
      id: order._id,
      status: order.status,
      totalPriceProducts: order.totalPriceProducts,
      totalPaidByCustomer: order.totalPaidByCustomer,
      totalShippingPrice: order.totalShippingPrice,
      totalDiscount: order.totalDiscount,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
    customer: {
      id: order.user?._id ?? order.user ?? null,
      name: order.user?.name ?? null,
    },
    subOrder: {
      id: subOrder._id,
      items: subOrder.items,
      coupon: subOrder.coupon ?? null,
      subTotal: subOrder.subTotal,
      shippingCost: subOrder.shippingCost,
      discountAmount: subOrder.discountAmount,
      platformFee: subOrder.platformFee,
      vendorNetAmount: subOrder.vendorNetAmount,
      status: subOrder.status,
      createdAt: subOrder.createdAt,
      updatedAt: subOrder.updatedAt,
      store: subOrder.store,
    },
    ...paymentView,
  };
};