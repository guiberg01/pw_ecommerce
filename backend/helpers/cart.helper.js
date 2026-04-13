import { randomUUID } from "crypto";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import { redis } from "../config/redis.js";
import { createHttpError } from "./httpError.js";
import { createRedisUnavailableError } from "./redisError.helper.js";

const GUEST_CART_COOKIE_NAME = "guestCartId";
const GUEST_CART_TTL_SECONDS = 30 * 24 * 60 * 60;
const GUEST_CART_SYNC_LOCK_TTL_SECONDS = 30;

const guestCartKey = (cartId) => `guestCart:${cartId}`;
const guestCartSyncLockKey = (cartId, userId) => `guestCart:sync:lock:${cartId}:${userId}`;

const getCartItemProductId = (product) => product?._id?.toString?.() ?? product?.toString?.() ?? product;

const cartCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: GUEST_CART_TTL_SECONDS * 1000,
};

export const ensureGuestCartId = (req, res) => {
  let cartId = req.cookies[GUEST_CART_COOKIE_NAME];

  if (!cartId) {
    cartId = randomUUID();
    res.cookie(GUEST_CART_COOKIE_NAME, cartId, cartCookieOptions);
  }

  return cartId;
};

export const clearGuestCartCookie = (res) => {
  res.clearCookie(GUEST_CART_COOKIE_NAME, cartCookieOptions);
};

export const readGuestCart = async (cartId) => {
  try {
    if (!cartId) return { items: [], auditTrail: [] };

    const payload = await redis.get(guestCartKey(cartId));
    return payload ? JSON.parse(payload) : { items: [], auditTrail: [] };
  } catch (error) {
    throw createRedisUnavailableError("Carrinho", "read-guest-cart", error);
  }
};

export const writeGuestCart = async (cartId, cart) => {
  try {
    await redis.set(guestCartKey(cartId), JSON.stringify(cart), "EX", GUEST_CART_TTL_SECONDS);
  } catch (error) {
    throw createRedisUnavailableError("Carrinho", "write-guest-cart", error);
  }
};

export const deleteGuestCart = async (cartId) => {
  try {
    if (!cartId) return;

    await redis.del(guestCartKey(cartId));
  } catch (error) {
    throw createRedisUnavailableError("Carrinho", "delete-guest-cart", error);
  }
};

export const acquireGuestCartSyncLock = async (cartId, userId) => {
  try {
    if (!cartId || !userId) return false;

    const acquired = await redis.set(
      guestCartSyncLockKey(cartId, userId.toString()),
      "locked",
      "EX",
      GUEST_CART_SYNC_LOCK_TTL_SECONDS,
      "NX",
    );

    return acquired === "OK";
  } catch (error) {
    throw createRedisUnavailableError("Carrinho", "acquire-guest-cart-sync-lock", error);
  }
};

export const releaseGuestCartSyncLock = async (cartId, userId) => {
  try {
    if (!cartId || !userId) return;
    await redis.del(guestCartSyncLockKey(cartId, userId.toString()));
  } catch (error) {
    throw createRedisUnavailableError("Carrinho", "release-guest-cart-sync-lock", error);
  }
};

export const mergeCartItems = (existingItems = [], incomingItems = []) => {
  const itemMap = new Map();

  for (const item of [...existingItems, ...incomingItems]) {
    const productId = getCartItemProductId(item.product);
    const quantity = Number(item.quantity ?? 1);

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;

    itemMap.set(productId, {
      product: productId,
      quantity: (itemMap.get(productId)?.quantity ?? 0) + quantity,
    });
  }

  return Array.from(itemMap.values());
};

export const getProductOrThrow = async (productId) => {
  const product = await Product.findOne({ _id: productId, status: { $ne: "deleted" } }).populate("store", "status");

  if (!product) {
    throw createHttpError("Produto não encontrado", 404);
  }

  if (product.store?.status === "deleted") {
    throw createHttpError("Produto indisponível", 404);
  }

  return product;
};

export const hydrateCartItems = async (items = []) => {
  const productIds = [...new Set(items.map((item) => getCartItemProductId(item.product)).filter(Boolean))];

  if (productIds.length === 0) return { hydratedItems: [], removedItems: [], sanitizedItems: [] };

  const products = await Product.find({
    _id: { $in: productIds },
    status: { $ne: "deleted" },
  }).populate({
    path: "store",
    select: "name slug owner status",
    match: { status: { $ne: "deleted" } },
  });

  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const hydratedItems = [];
  const removedItems = [];
  const sanitizedItems = [];

  for (const item of items) {
    const product = productMap.get(getCartItemProductId(item.product));
    const originalQuantity = Math.trunc(Number(item.quantity ?? 0));

    if (!product || !product.store) {
      removedItems.push({
        productId: getCartItemProductId(item.product),
        reason: !product ? "Produto removido" : "Loja indisponível",
        quantity: originalQuantity,
      });
      continue;
    }

    const maxAllowed = getMaxQuantityPerPerson(product);
    const cappedByStock = Math.min(originalQuantity, Number(product.stock ?? 0));
    const normalizedQuantity = Math.min(cappedByStock, maxAllowed);

    if (normalizedQuantity <= 0) {
      removedItems.push({
        productId: product._id.toString(),
        reason: "Produto sem estoque disponível",
        quantity: originalQuantity,
      });
      continue;
    }

    if (normalizedQuantity !== originalQuantity) {
      removedItems.push({
        productId: product._id.toString(),
        reason: `Quantidade ajustada para ${normalizedQuantity}`,
        quantity: originalQuantity,
      });
    }

    hydratedItems.push({
      product,
      quantity: normalizedQuantity,
    });

    sanitizedItems.push({
      product: product._id.toString(),
      quantity: normalizedQuantity,
    });
  }

  return { hydratedItems, removedItems, sanitizedItems };
};

export const getMaxQuantityPerPerson = (product) => {
  return product?.maxPerPerson ?? product?.stock ?? 1;
};

export const sanitizeCartItems = async (items = []) => {
  const { sanitizedItems } = await hydrateCartItems(items);
  return sanitizedItems;
};

export const calcCartTotals = (hydratedItems = []) => {
  let totalPrice = 0;
  let itemCount = 0;

  for (const item of hydratedItems) {
    const price = Number(item.product?.price ?? 0);
    const quantity = Number(item.quantity ?? 0);
    totalPrice += price * quantity;
    itemCount += quantity;
  }

  return {
    itemCount,
    totalPrice: Math.round(totalPrice * 100) / 100,
  };
};

export const upsertCartItem = (items = [], productId, quantity, { increment = false } = {}) => {
  const normalizedQuantity = Math.trunc(Number(quantity));
  const normalizedProductId = getCartItemProductId(productId);

  if (!normalizedProductId || !Number.isFinite(normalizedQuantity)) {
    return items;
  }

  const itemMap = new Map(
    items.map((item) => [getCartItemProductId(item.product), { ...item, product: getCartItemProductId(item.product) }]),
  );
  const currentQuantity = Number(itemMap.get(normalizedProductId)?.quantity ?? 0);

  itemMap.set(normalizedProductId, {
    product: normalizedProductId,
    quantity: increment ? currentQuantity + normalizedQuantity : normalizedQuantity,
  });

  return Array.from(itemMap.values()).filter((item) => Number(item.quantity) > 0);
};

export const removeCartItem = (items = [], productId) =>
  items.filter((item) => getCartItemProductId(item.product) !== productId.toString());

export const getMongoCart = async (userId) => {
  return Cart.findOne({ user: userId }).populate({
    path: "items.product",
    select: "name price imageUrl category highlighted stock maxPerPerson status store",
    populate: {
      path: "store",
      select: "name slug owner status",
      match: { status: { $ne: "deleted" } },
    },
  });
};

export const findOrCreatePersistedCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }

  return cart;
};

export const syncGuestCartToUserCart = async (userId, cartId) => {
  if (!cartId) return null;

  const lockAcquired = await acquireGuestCartSyncLock(cartId, userId);

  if (!lockAcquired) {
    return getMongoCart(userId);
  }

  try {
    const guestCart = await readGuestCart(cartId);
    const guestItems = await sanitizeCartItems(guestCart?.items ?? []);

    if (guestItems.length === 0) {
      await deleteGuestCart(cartId);
      return null;
    }

    const existingCart = await findOrCreatePersistedCart(userId);
    const mergedItems = mergeCartItems(existingCart.items, guestItems);
    existingCart.items = await sanitizeCartItems(mergedItems);
    await existingCart.save();

    await deleteGuestCart(cartId);

    return existingCart;
  } finally {
    await releaseGuestCartSyncLock(cartId, userId);
  }
};
