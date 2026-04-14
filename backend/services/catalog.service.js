import Product from "../models/product.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";

const PRODUCT_RESPONSE_POPULATE = "store name slug owner status";

export const getVisibleProducts = async () => {
  const activeStoreIds = await Store.find({ status: "active" }).distinct("_id");

  if (activeStoreIds.length === 0) {
    return [];
  }

  return Product.find({
    status: "available",
    store: { $in: activeStoreIds },
  }).populate({
    path: "store",
    select: "name slug owner status",
    match: { status: { $ne: "deleted" } },
  });
};

export const getProduct = async (productId) => {
  const product = await Product.findOne({ _id: productId, status: { $in: ["available", "unavailable"] } })
    .populate("store", "name reputation")
    .lean();

  if (!product) {
    throw createHttpError("Produto não encontrado", 404, undefined, "PRODUCT_NOT_FOUND");
  }

  return product;
};

export const findActiveStoreOrThrow = async (storeId) => {
  const store = await Store.findOne({ _id: storeId, status: { $ne: "deleted" } });

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
  }

  return store;
};

export const findActiveStoreByOwner = async (ownerId) => {
  return Store.findOne({ owner: ownerId, status: { $ne: "deleted" } });
};

export const findActiveStoreByOwnerOrThrow = async (ownerId) => {
  const store = await findActiveStoreByOwner(ownerId);

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
  }

  return store;
};

export const findStoreByIdOrThrow = async (storeId) => {
  const store = await Store.findOne({ _id: storeId, status: { $ne: "deleted" } }).populate("owner", "name email role");

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
  }

  return store;
};

export const ensureStoreHasNoActiveProducts = async (storeId) => {
  const hasProduct = await Product.exists({ store: storeId, status: { $ne: "deleted" } });

  if (hasProduct) {
    throw createHttpError("Não é possível deletar uma loja que possui produtos", 400, undefined, "STORE_HAS_PRODUCTS");
  }
};

export const softDeleteStore = async (storeId) => {
  await Store.findByIdAndUpdate(storeId, { status: "deleted" });
};

export const createProductForStore = async (storeId, payload) => {
  const product = new Product({
    ...payload,
    store: storeId,
  });

  await product.save();

  return Product.findById(product._id).populate("store", PRODUCT_RESPONSE_POPULATE);
};

export const findActiveProductOrThrow = async (productId, { populateStoreOwner = false } = {}) => {
  const query = Product.findOne({ _id: productId, status: { $ne: "deleted" } });

  if (populateStoreOwner) {
    query.populate("store", "owner");
  }

  const product = await query;

  if (!product) {
    throw createHttpError("Produto não encontrado", 404, undefined, "PRODUCT_NOT_FOUND");
  }

  return product;
};

export const updateProductAndPopulate = async (product, payload) => {
  Object.assign(product, payload);
  await product.save();

  return Product.findById(product._id).populate("store", PRODUCT_RESPONSE_POPULATE);
};

export const softDeleteProduct = async (productId) => {
  await Product.findByIdAndUpdate(productId, { status: "deleted" });
};
