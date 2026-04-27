import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Payment from "../models/payment.model.js";
import Shipping from "../models/shipping.model.js";
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

const buildOrderLookupFilters = (orderFilters) => {
  const lookupFilters = {};

  if (orderFilters.status) {
    lookupFilters["orderDoc.status"] = orderFilters.status;
  }

  if (orderFilters.createdAt) {
    lookupFilters["orderDoc.createdAt"] = orderFilters.createdAt;
  }

  return lookupFilters;
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

export const listOrdersForSeller = async (
  ownerId,
  { page = 1, limit = 20, orderStatus, subOrderStatus, createdFrom, createdTo, sort = "newest" } = {},
) => {
  const store = await findActiveStoreByOwnerOrThrow(ownerId);
  const orderFilters = buildOrderFilters({ orderStatus, createdFrom, createdTo });
  const sortDirection = sortDirectionFromValue(sort);
  const skip = (page - 1) * limit;

  const subOrderFilters = {
    store: store._id,
  };

  if (subOrderStatus) {
    subOrderFilters.status = subOrderStatus;
  }

  const orderLookupFilters = buildOrderLookupFilters(orderFilters);
  const basePipeline = [
    { $match: subOrderFilters },
    {
      $lookup: {
        from: "orders",
        localField: "order",
        foreignField: "_id",
        as: "orderDoc",
      },
    },
    { $unwind: "$orderDoc" },
  ];

  if (Object.keys(orderLookupFilters).length > 0) {
    basePipeline.push({ $match: orderLookupFilters });
  }

  const groupedOrdersPipeline = [
    ...basePipeline,
    {
      $group: {
        _id: "$orderDoc._id",
        createdAt: { $first: "$orderDoc.createdAt" },
      },
    },
  ];

  const [totalRows, pagedOrderRows, summaryRows] = await Promise.all([
    SubOrder.aggregate([...groupedOrdersPipeline, { $count: "total" }]),
    SubOrder.aggregate([
      ...groupedOrdersPipeline,
      { $sort: { createdAt: sortDirection, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 1 } },
    ]),
    SubOrder.aggregate([
      ...basePipeline,
      {
        $addFields: {
          itemCount: {
            $reduce: {
              input: { $ifNull: ["$items", []] },
              initialValue: 0,
              in: { $add: ["$$value", { $toInt: { $ifNull: ["$$this.quantity", 0] } }] },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          grossRevenue: { $sum: { $ifNull: ["$subTotal", 0] } },
          netRevenue: { $sum: { $ifNull: ["$vendorNetAmount", 0] } },
          discountTotal: { $sum: { $ifNull: ["$discountAmount", 0] } },
          shippingTotal: { $sum: { $ifNull: ["$shippingCost", 0] } },
          itemsCount: { $sum: "$itemCount" },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] } },
          shipping: { $sum: { $cond: [{ $eq: ["$status", "shipping"] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const total = Number(totalRows[0]?.total ?? 0);
  if (total === 0) {
    return buildPaginationResult([], 0, page, limit, {
      summary: buildSellerOrderSummary([], []),
    });
  }

  const pagedOrderIds = pagedOrderRows.map((row) => row._id);
  if (pagedOrderIds.length === 0) {
    const aggregateSummary = summaryRows[0];
    return buildPaginationResult([], total, page, limit, {
      summary: {
        orderCount: Number(aggregateSummary?.orderCount ?? 0),
        grossRevenue: Number(aggregateSummary?.grossRevenue ?? 0),
        netRevenue: Number(aggregateSummary?.netRevenue ?? 0),
        discountTotal: Number(aggregateSummary?.discountTotal ?? 0),
        shippingTotal: Number(aggregateSummary?.shippingTotal ?? 0),
        itemsCount: Number(aggregateSummary?.itemsCount ?? 0),
        statusBreakdown: {
          pending: Number(aggregateSummary?.pending ?? 0),
          paid: Number(aggregateSummary?.paid ?? 0),
          processing: Number(aggregateSummary?.processing ?? 0),
          shipping: Number(aggregateSummary?.shipping ?? 0),
          delivered: Number(aggregateSummary?.delivered ?? 0),
          cancelled: Number(aggregateSummary?.cancelled ?? 0),
          failed: Number(aggregateSummary?.failed ?? 0),
        },
      },
    });
  }

  const [pagedOrders, pagedSubOrders, payments] = await Promise.all([
    Order.find({ _id: { $in: pagedOrderIds } })
      .populate("user", "name")
      .select(ORDER_SELECT_FIELDS)
      .lean(),
    SubOrder.find({ order: { $in: pagedOrderIds }, store: store._id }).select(SUB_ORDER_SELECT_FIELDS).lean(),
    Payment.find({ order: { $in: pagedOrderIds } })
      .select(PAYMENT_SELECT_FIELDS)
      .lean(),
  ]);

  const orderById = new Map(pagedOrders.map((order) => [order._id.toString(), order]));
  const subOrderByOrderId = new Map(pagedSubOrders.map((subOrder) => [subOrder.order.toString(), subOrder]));
  const paymentsByOrderId = groupByOrderId(payments);

  const items = pagedOrderIds
    .map((orderId) => {
      const order = orderById.get(orderId.toString());
      const subOrder = subOrderByOrderId.get(orderId.toString());

      if (!order || !subOrder) {
        return null;
      }

      const paymentView = buildPaymentView(paymentsByOrderId.get(order._id.toString()) ?? [], {
        includeGatewayIds: false,
      });

      return buildSellerOrderItem({
        order,
        subOrder,
        paymentView,
      });
    })
    .filter(Boolean);

  if (items.length !== pagedOrderIds.length) {
    throw createHttpError("Pedido do seller não encontrado", 404, undefined, "SELLER_ORDER_NOT_FOUND");
  }

  const aggregateSummary = summaryRows[0];

  return buildPaginationResult(items, total, page, limit, {
    summary: {
      orderCount: Number(aggregateSummary?.orderCount ?? 0),
      grossRevenue: Number(aggregateSummary?.grossRevenue ?? 0),
      netRevenue: Number(aggregateSummary?.netRevenue ?? 0),
      discountTotal: Number(aggregateSummary?.discountTotal ?? 0),
      shippingTotal: Number(aggregateSummary?.shippingTotal ?? 0),
      itemsCount: Number(aggregateSummary?.itemsCount ?? 0),
      statusBreakdown: {
        pending: Number(aggregateSummary?.pending ?? 0),
        paid: Number(aggregateSummary?.paid ?? 0),
        processing: Number(aggregateSummary?.processing ?? 0),
        shipping: Number(aggregateSummary?.shipping ?? 0),
        delivered: Number(aggregateSummary?.delivered ?? 0),
        cancelled: Number(aggregateSummary?.cancelled ?? 0),
        failed: Number(aggregateSummary?.failed ?? 0),
      },
    },
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

  const shippingDoc = await Shipping.findOne({ subOrder: subOrder._id })
    .select("_id labelUrl trackingCode melhorEnvioOrderId status updatedAt")
    .lean();

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
      shipping: {
        id: shippingDoc?._id ?? null,
        labelUrl: shippingDoc?.labelUrl ?? null,
        trackingCode: shippingDoc?.trackingCode ?? null,
        melhorEnvioOrderId: shippingDoc?.melhorEnvioOrderId ?? null,
        status: shippingDoc?.status ?? null,
        updatedAt: shippingDoc?.updatedAt ?? null,
      },
    },
    ...paymentView,
  };
};