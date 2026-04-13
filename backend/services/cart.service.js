import Cart from "../models/cart.model.js";
import {
  calcCartTotals,
  ensureGuestCartId,
  findOrCreatePersistedCart,
  getMaxQuantityPerPerson,
  getProductOrThrow,
  hydrateCartItems,
  readGuestCart,
  removeCartItem,
  upsertCartItem,
  writeGuestCart,
} from "../helpers/cart.helper.js";
import { createHttpError } from "../helpers/httpError.js";

const MAX_VERSION_RETRIES = 3;
const MAX_AUDIT_EVENTS = 50;

const isAuthenticated = (req) => Boolean(req.user?._id);

const withVersionRetry = async (executor) => {
  let lastError;

  for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt += 1) {
    try {
      return await executor();
    } catch (error) {
      lastError = error;

      if (error?.name !== "VersionError") {
        throw error;
      }
    }
  }

  throw lastError;
};

const appendAuditTrail = (currentAuditTrail = [], auditEvents = []) =>
  [...currentAuditTrail, ...auditEvents].slice(-MAX_AUDIT_EVENTS);

const cartItemsEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;

  const mapA = new Map(a.map((item) => [item.product.toString(), Number(item.quantity)]));

  for (const item of b) {
    if (mapA.get(item.product.toString()) !== Number(item.quantity)) {
      return false;
    }
  }

  return true;
};

const getCartTarget = async (req, res) => {
  if (isAuthenticated(req)) {
    const cart = await Cart.findOne({ user: req.user._id });
    return { cart: cart ?? { items: [], auditTrail: [] } };
  }

  const guestCartId = ensureGuestCartId(req, res);
  const guestCart = await readGuestCart(guestCartId);
  return { cart: guestCart ?? { items: [], auditTrail: [] }, guestCartId };
};

const toAuditEvents = (removedItems = []) =>
  removedItems.map((item) => ({
    at: new Date(),
    productId: String(item.productId),
    reason: String(item.reason),
    quantity: Number(item.quantity ?? 0),
  }));

const buildCartResponse = async (req, target, items) => {
  const { hydratedItems, removedItems, sanitizedItems } = await hydrateCartItems(items);
  const { itemCount, totalPrice } = calcCartTotals(hydratedItems);
  const auditTrail = target.auditTrail ?? target.cart?.auditTrail ?? [];

  return {
    guestCartId: isAuthenticated(req) ? null : target.guestCartId,
    items: hydratedItems,
    sanitizedItems,
    itemCount,
    totalPrice,
    removedItems: removedItems.length > 0 ? removedItems : null,
    auditTrail,
    lastUpdated: new Date().toISOString(),
  };
};

export const getItemQuantityInCart = (items, productId) => {
  const match = items.find((item) => item.product?.toString?.() === productId.toString());
  return Number(match?.quantity ?? 0);
};

export const addProductToCartForRequest = async (req, res, productId, quantity = 1) => {
  const product = await getProductOrThrow(productId);

  if (product.stock <= 0) {
    throw createHttpError("Produto sem estoque disponível", 400, undefined, "CART_OUT_OF_STOCK");
  }

  return mutateCartForRequest(req, res, (items) => {
    const currentQuantity = getItemQuantityInCart(items, product._id);
    const maxAllowed = getMaxQuantityPerPerson(product);
    const finalQuantity = currentQuantity + Number(quantity);

    if (finalQuantity > maxAllowed || finalQuantity > Number(product.stock)) {
      const hardLimit = Math.min(maxAllowed, Number(product.stock));
      throw createHttpError(
        `Quantidade máxima por pessoa: ${hardLimit}`,
        400,
        { hardLimit, productId: product._id.toString() },
        "CART_MAX_PER_PERSON_EXCEEDED",
      );
    }

    return upsertCartItem(items, product._id, quantity, { increment: true });
  });
};

export const updateProductQuantityForRequest = async (req, res, productId, quantity) => {
  const product = await getProductOrThrow(productId);

  if (product.stock <= 0) {
    throw createHttpError("Produto sem estoque disponível", 400, undefined, "CART_OUT_OF_STOCK");
  }

  const maxAllowed = getMaxQuantityPerPerson(product);
  const hardLimit = Math.min(maxAllowed, Number(product.stock));
  if (quantity > hardLimit) {
    throw createHttpError(
      `Quantidade máxima por pessoa: ${hardLimit}`,
      400,
      { hardLimit, productId: product._id.toString() },
      "CART_MAX_PER_PERSON_EXCEEDED",
    );
  }

  return mutateCartForRequest(req, res, (items) => upsertCartItem(items, productId, quantity));
};

export const decrementProductForRequest = async (req, res, productId) => {
  await getProductOrThrow(productId);
  return mutateCartForRequest(req, res, (items) => upsertCartItem(items, productId, -1, { increment: true }));
};

export const removeProductFromCartForRequest = async (req, res, productId) => {
  await getProductOrThrow(productId);
  return mutateCartForRequest(req, res, (items) => removeCartItem(items, productId));
};

export const clearCartForRequest = async (req, res) => {
  return mutateCartForRequest(req, res, () => []);
};

export const mutateCartForRequest = async (req, res, mutator) => {
  if (isAuthenticated(req)) {
    return withVersionRetry(async () => {
      const cart = await findOrCreatePersistedCart(req.user._id);
      const currentItems = cart.items ?? [];
      const nextItems = await mutator(currentItems);
      const response = await buildCartResponse(req, { auditTrail: cart.auditTrail ?? [] }, nextItems);
      const auditEvents = toAuditEvents(response.removedItems ?? []);

      cart.items = response.sanitizedItems;
      cart.auditTrail = appendAuditTrail(cart.auditTrail ?? [], auditEvents);
      await cart.save();

      response.auditTrail = cart.auditTrail;
      delete response.sanitizedItems;
      return response;
    });
  }

  const target = await getCartTarget(req, res);
  const nextItems = await mutator(target.cart.items ?? []);
  const response = await buildCartResponse(req, target, nextItems);
  const auditEvents = toAuditEvents(response.removedItems ?? []);
  const nextAuditTrail = appendAuditTrail(target.cart.auditTrail ?? [], auditEvents);

  await writeGuestCart(target.guestCartId, {
    items: response.sanitizedItems,
    auditTrail: nextAuditTrail,
  });

  response.auditTrail = nextAuditTrail;
  delete response.sanitizedItems;
  return response;
};

export const getCartForRequest = async (req, res) => {
  if (isAuthenticated(req)) {
    return withVersionRetry(async () => {
      const cart = await findOrCreatePersistedCart(req.user._id);
      const response = await buildCartResponse(req, { auditTrail: cart.auditTrail ?? [] }, cart.items ?? []);
      const auditEvents = toAuditEvents(response.removedItems ?? []);
      const shouldPersistItems = !cartItemsEqual(cart.items ?? [], response.sanitizedItems);
      const shouldPersistAudit = auditEvents.length > 0;

      if (shouldPersistItems || shouldPersistAudit) {
        cart.items = response.sanitizedItems;
        cart.auditTrail = appendAuditTrail(cart.auditTrail ?? [], auditEvents);
        await cart.save();
        response.auditTrail = cart.auditTrail;
      } else {
        response.auditTrail = cart.auditTrail ?? [];
      }

      delete response.sanitizedItems;
      return response;
    });
  }

  const target = await getCartTarget(req, res);
  const response = await buildCartResponse(req, target, target.cart.items ?? []);
  const auditEvents = toAuditEvents(response.removedItems ?? []);
  const nextAuditTrail = appendAuditTrail(target.cart.auditTrail ?? [], auditEvents);

  if (!cartItemsEqual(target.cart.items ?? [], response.sanitizedItems) || auditEvents.length > 0) {
    await writeGuestCart(target.guestCartId, {
      items: response.sanitizedItems,
      auditTrail: nextAuditTrail,
    });
  }

  response.auditTrail = nextAuditTrail;
  delete response.sanitizedItems;
  return response;
};
