import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";
import Store from "../models/store.model.js";
import Order from "../models/order.model.js";
import SubOrder from "../models/subOrder.model.js";
import Product from "../models/product.model.js";
import Cart from "../models/cart.model.js";
import Coupon from "../models/coupon.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { redis } from "../config/redis.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CART_REMINDER_COOLDOWN_SECONDS = 24 * 60 * 60;
const COUPON_EXPIRING_DAYS = Number(process.env.COUPON_EXPIRING_NOTIFY_DAYS ?? 3);

const normalizePagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limit)))
    : DEFAULT_LIMIT;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
};

const buildPaginationResult = ({ items, total, page, limit, unreadCount }) => ({
  items,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / Math.max(limit, 1)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
    unreadCount,
  },
});

const parseBooleanFilter = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const buildListFilters = (userId, query = {}) => {
  const filters = { user: userId };

  const readFilter = parseBooleanFilter(query.isRead);
  if (readFilter !== undefined) {
    filters.isRead = readFilter;
  }

  if (query.type) {
    filters.type = query.type;
  }

  return filters;
};

export const createNotificationForUser = async (userId, payload) => {
  if (!userId) return null;

  return Notification.create({
    user: userId,
    title: payload.title,
    message: payload.message,
    type: payload.type,
    recipientRole: payload.recipientRole ?? null,
    actionUrl: payload.actionUrl ?? null,
    metadata: payload.metadata ?? null,
    refModel: payload.refModel ?? { refId: null, refModel: null },
  });
};

export const createNotificationsForUsers = async (userIds, payload) => {
  const uniqueUserIds = [...new Set((userIds ?? []).map((id) => String(id)).filter(Boolean))];
  if (uniqueUserIds.length === 0) return { insertedCount: 0 };

  const docs = uniqueUserIds.map((userId) => ({
    user: userId,
    title: payload.title,
    message: payload.message,
    type: payload.type,
    recipientRole: payload.recipientRole ?? null,
    actionUrl: payload.actionUrl ?? null,
    metadata: payload.metadata ?? null,
    refModel: payload.refModel ?? { refId: null, refModel: null },
  }));

  await Notification.insertMany(docs, { ordered: false });
  return { insertedCount: docs.length };
};

const findTargetUserIdsByAudience = async (audience) => {
  if (audience === "everyone") {
    return User.find({ status: "active", role: { $in: ["customer", "seller"] } }).distinct("_id");
  }

  if (audience === "customer") {
    return User.find({ status: "active", role: "customer" }).distinct("_id");
  }

  if (audience === "seller") {
    return User.find({ status: "active", role: "seller" }).distinct("_id");
  }

  throw createHttpError("Público alvo inválido", 400, undefined, "NOTIFICATION_INVALID_AUDIENCE");
};

export const createAdminBroadcastNotification = async ({ title, message, actionUrl, audience, type }) => {
  const userIds = await findTargetUserIdsByAudience(audience);

  const result = await createNotificationsForUsers(userIds, {
    title,
    message,
    type,
    recipientRole: audience,
    actionUrl,
  });

  return {
    audience,
    totalRecipients: userIds.length,
    insertedCount: result.insertedCount,
  };
};

export const listNotificationsForUser = async (userId, query = {}) => {
  const { page, limit, skip } = normalizePagination(query);
  const filters = buildListFilters(userId, query);

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filters),
    Notification.countDocuments({ user: userId, isRead: false }),
  ]);

  return buildPaginationResult({ items, total, page, limit, unreadCount });
};

export const getUnreadNotificationCount = async (userId) => {
  const unreadCount = await Notification.countDocuments({ user: userId, isRead: false });
  return { unreadCount };
};

const findOwnedNotificationOrThrow = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, user: userId });

  if (!notification) {
    throw createHttpError("Notificação não encontrada", 404, undefined, "NOTIFICATION_NOT_FOUND");
  }

  return notification;
};

export const markNotificationAsRead = async (userId, notificationId) => {
  const notification = await findOwnedNotificationOrThrow(userId, notificationId);

  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }

  return notification;
};

export const clickNotification = async (userId, notificationId) => {
  const notification = await findOwnedNotificationOrThrow(userId, notificationId);

  notification.isRead = true;
  notification.readAt = notification.readAt ?? new Date();
  notification.clickedAt = new Date();
  await notification.save();

  return {
    notification,
    actionUrl: notification.actionUrl ?? null,
  };
};

export const markAllNotificationsAsRead = async (userId) => {
  const result = await Notification.updateMany(
    { user: userId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
  );

  return {
    modifiedCount: result.modifiedCount,
  };
};

export const deleteNotification = async (userId, notificationId) => {
  const result = await Notification.deleteOne({ _id: notificationId, user: userId });

  if (!result.deletedCount) {
    throw createHttpError("Notificação não encontrada", 404, undefined, "NOTIFICATION_NOT_FOUND");
  }

  return { deletedCount: result.deletedCount };
};

export const deleteAllNotifications = async (userId) => {
  const result = await Notification.deleteMany({ user: userId });
  return { deletedCount: result.deletedCount };
};

export const notifyOrderPaid = async (orderId) => {
  const [order, subOrders] = await Promise.all([
    Order.findById(orderId).select("_id user").lean(),
    SubOrder.find({ order: orderId }).select("_id store").lean(),
  ]);

  if (!order) return;

  await createNotificationForUser(order.user, {
    title: "Pagamento confirmado",
    message: `Seu pedido #${order._id.toString().slice(-6)} foi confirmado e está em preparação.`,
    type: "order_status",
    recipientRole: "customer",
    actionUrl: `/orders/${order._id}`,
    refModel: { refId: order._id, refModel: "Order" },
  });

  const storeIds = [...new Set(subOrders.map((subOrder) => String(subOrder.store)))];
  const stores = await Store.find({ _id: { $in: storeIds } }).select("_id owner name").lean();

  await createNotificationsForUsers(
    stores.map((store) => store.owner),
    {
      title: "Produto vendido",
      message: `Você recebeu uma nova venda na loja ${stores.length === 1 ? stores[0].name : ""}`.trim(),
      type: "product_sold",
      recipientRole: "seller",
      actionUrl: `/stores/me/orders/${order._id}`,
      refModel: { refId: order._id, refModel: "Order" },
    },
  );
};

export const notifyOrderStatusForCustomer = async ({ orderId, userId, status }) => {
  await createNotificationForUser(userId, {
    title: "Atualização no pedido",
    message: `Seu pedido #${String(orderId).slice(-6)} mudou para: ${status}.`,
    type: "order_status",
    recipientRole: "customer",
    actionUrl: `/orders/${orderId}`,
    refModel: { refId: orderId, refModel: "Order" },
    metadata: { status },
  });
};

export const notifyOrderFailedOrCancelled = async ({ orderId }) => {
  const [order, subOrders] = await Promise.all([
    Order.findById(orderId).select("_id user status").lean(),
    SubOrder.find({ order: orderId }).select("store").lean(),
  ]);

  if (!order) return;

  const sellerStoreIds = [...new Set(subOrders.map((subOrder) => String(subOrder.store)))];
  const stores = await Store.find({ _id: { $in: sellerStoreIds } }).select("owner").lean();

  await Promise.all([
    createNotificationForUser(order.user, {
      title: "Pedido não concluído",
      message: `Houve um problema com o pedido #${order._id.toString().slice(-6)}.`,
      type: "order_cancelled",
      recipientRole: "customer",
      actionUrl: `/orders/${order._id}`,
      refModel: { refId: order._id, refModel: "Order" },
      metadata: { status: order.status },
    }),
    createNotificationsForUsers(
      stores.map((store) => store.owner),
      {
        title: "Pedido cancelado/falhou",
        message: `O pedido #${order._id.toString().slice(-6)} não foi concluído.`,
        type: "order_cancelled",
        recipientRole: "seller",
        actionUrl: `/stores/me/orders/${order._id}`,
        refModel: { refId: order._id, refModel: "Order" },
      },
    ),
  ]);
};

export const notifyRefundEvent = async ({ orderId, userId, sellerIds = [] }) => {
  await Promise.all([
    createNotificationForUser(userId, {
      title: "Reembolso atualizado",
      message: `O reembolso do pedido #${String(orderId).slice(-6)} foi atualizado.`,
      type: "refund",
      recipientRole: "customer",
      actionUrl: `/orders/${orderId}`,
      refModel: { refId: orderId, refModel: "Order" },
    }),
    createNotificationsForUsers(sellerIds, {
      title: "Reembolso em pedido",
      message: `Um pedido da loja recebeu atualização de reembolso (#${String(orderId).slice(-6)}).`,
      type: "refund",
      recipientRole: "seller",
      actionUrl: `/stores/me/orders/${orderId}`,
      refModel: { refId: orderId, refModel: "Order" },
    }),
  ]);
};

export const notifyReviewCreatedForSeller = async ({ productId, reviewId, rating }) => {
  const product = await Product.findById(productId).select("_id store name").lean();
  if (!product?.store) return;

  const store = await Store.findById(product.store).select("_id owner").lean();
  if (!store?.owner) return;

  await createNotificationForUser(store.owner, {
    title: "Nova review recebida",
    message: `Seu produto recebeu uma review com nota ${rating}.`,
    type: "review_received",
    recipientRole: "seller",
    actionUrl: `/stores/me/reviews`,
    refModel: { refId: reviewId, refModel: "Review" },
    metadata: { productId: product._id, rating },
  });
};

export const notifyReviewReplyForCustomer = async ({ userId, reviewId, productId }) => {
  await createNotificationForUser(userId, {
    title: "Resposta do vendedor",
    message: "O vendedor respondeu sua review.",
    type: "seller_reply",
    recipientRole: "customer",
    actionUrl: `/products/${productId}`,
    refModel: { refId: reviewId, refModel: "Review" },
    metadata: { productId },
  });
};

export const notifyNewCouponForCustomers = async (coupon) => {
  const customerIds = await User.find({ role: "customer", status: "active" }).distinct("_id");

  return createNotificationsForUsers(customerIds, {
    title: "Novo cupom disponível",
    message: `Novo cupom: ${coupon.code}. Aproveite antes de expirar!`,
    type: "coupon_new",
    recipientRole: "customer",
    actionUrl: "/coupons",
    refModel: { refId: coupon._id, refModel: "Coupon" },
    metadata: {
      code: coupon.code,
      expiresAt: coupon.expiresAt,
    },
  });
};

export const notifyCouponsExpiringSoon = async () => {
  const now = new Date();
  const until = new Date(now.getTime() + COUPON_EXPIRING_DAYS * 24 * 60 * 60 * 1000);

  const coupons = await Coupon.find({
    status: "active",
    expiresAt: { $ne: null, $gt: now, $lte: until },
  })
    .select("_id code expiresAt")
    .lean();

  if (!coupons.length) {
    return { notifiedCoupons: 0, notificationsCreated: 0 };
  }

  const customerIds = await User.find({ role: "customer", status: "active" }).distinct("_id");
  let totalNotificationsCreated = 0;
  let notifiedCoupons = 0;

  for (const coupon of coupons) {
    const dedupeKey = `notifications:coupon-expiring:${coupon._id.toString()}`;
    const dedupe = await redis.set(dedupeKey, "1", "NX", "EX", 24 * 60 * 60);

    if (dedupe !== "OK") {
      continue;
    }

    notifiedCoupons += 1;
    const result = await createNotificationsForUsers(customerIds, {
      title: "Cupom perto de expirar",
      message: `O cupom ${coupon.code} está perto de expirar.`,
      type: "coupon_expiring",
      recipientRole: "customer",
      actionUrl: "/coupons",
      refModel: { refId: coupon._id, refModel: "Coupon" },
      metadata: { code: coupon.code, expiresAt: coupon.expiresAt },
    });

    totalNotificationsCreated += result.insertedCount;
  }

  return {
    notifiedCoupons,
    notificationsCreated: totalNotificationsCreated,
  };
};

export const notifyProductDiscountForCustomers = async ({ productId, oldPrice, newPrice }) => {
  const customerIds = await User.find({ role: "customer", status: "active" }).distinct("_id");

  return createNotificationsForUsers(customerIds, {
    title: "Produto com desconto",
    message: `Um produto caiu de R$ ${Number(oldPrice).toFixed(2)} para R$ ${Number(newPrice).toFixed(2)}.`,
    type: "product_discount",
    recipientRole: "customer",
    actionUrl: `/products/${productId}`,
    refModel: { refId: productId, refModel: "Product" },
    metadata: { oldPrice, newPrice },
  });
};

export const notifyPromotionForCustomers = async ({ productId, productName }) => {
  const customerIds = await User.find({ role: "customer", status: "active" }).distinct("_id");

  return createNotificationsForUsers(customerIds, {
    title: "Nova promoção",
    message: `${productName} entrou em destaque promocional.`,
    type: "promotion",
    recipientRole: "customer",
    actionUrl: `/products/${productId}`,
    refModel: { refId: productId, refModel: "Product" },
  });
};

export const notifyCartReminderForUser = async (userId, { itemCount }) => {
  const dedupeKey = `notifications:cart-reminder:${String(userId)}`;
  const lock = await redis.set(dedupeKey, "1", "NX", "EX", CART_REMINDER_COOLDOWN_SECONDS);

  if (lock !== "OK") {
    return null;
  }

  return createNotificationForUser(userId, {
    title: "Finalize sua compra",
    message: `Você tem ${itemCount} item(ns) no carrinho esperando por você.`,
    type: "cart_reminder",
    recipientRole: "customer",
    actionUrl: "/cart",
    refModel: { refId: null, refModel: null },
    metadata: { itemCount },
  });
};

export const notifyStoreVisitMilestone = async ({ storeId, ownerId, visitsCount }) => {
  if (!visitsCount || visitsCount % 50 !== 0) {
    return null;
  }

  return createNotificationForUser(ownerId, {
    title: "Movimento na sua loja",
    message: `Sua loja alcançou ${visitsCount} visitas.`,
    type: "store_visits",
    recipientRole: "seller",
    actionUrl: `/stores/${storeId}`,
    refModel: { refId: storeId, refModel: "Store" },
    metadata: { visitsCount },
  });
};

export const notifyUsersWithActiveCart = async () => {
  const carts = await Cart.find({
    items: { $exists: true, $ne: [] },
  })
    .select("user items updatedAt")
    .lean();

  let sent = 0;

  for (const cart of carts) {
    const hoursSinceUpdate = (Date.now() - new Date(cart.updatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceUpdate < 6) continue;

    const result = await notifyCartReminderForUser(cart.user, { itemCount: cart.items.length });
    if (result) sent += 1;
  }

  return { sent };
};
