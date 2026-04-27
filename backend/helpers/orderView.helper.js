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

export const sortPaymentAttempts = (payments = []) => {
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

export const formatPaymentAttempt = (payment = {}, { includeGatewayIds = true } = {}) => {
  const formattedPayment = {
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
  };

  if (includeGatewayIds) {
    formattedPayment.stripePaymentIntentId = payment.stripePaymentIntentId;
    formattedPayment.stripeChargeId = payment.stripeChargeId;
  }

  return formattedPayment;
};

export const buildPaymentView = (payments = [], options = {}) => {
  const orderedAttempts = sortPaymentAttempts(payments);
  const paymentAttempts = orderedAttempts.map((attempt) => formatPaymentAttempt(attempt, options));
  const paymentCurrent = paymentAttempts[0] ?? null;

  return {
    paymentCurrent,
    paymentAttempts,
    payment: paymentCurrent,
  };
};

export const buildPaginationResult = (items, total, page, limit, extra = {}) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  },
  ...extra,
});

export const groupByOrderId = (items = [], orderField = "order") => {
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
