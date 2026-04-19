import Product from "../models/product.model.js";
import ProductVariant from "../models/productVariant.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import {
  createDocumentWithUniqueSlug,
  isDuplicateFieldError,
  saveDocumentWithUniqueSlug,
} from "../helpers/slugUnique.helper.js";

const PRODUCT_RESPONSE_POPULATE = "store name slug owner status";
const MAX_SLUG_RETRIES = 5;
const PRODUCT_FIELDS = ["name", "description", "category", "highlighted", "maxPerPerson", "status"];
const VARIANT_FIELDS = [
  "attributes",
  "price",
  "stock",
  "sku",
  "imageUrl",
  "datasheet",
  "weight",
  "length",
  "width",
  "height",
];

const populateProductById = (productId) =>
  Product.findById(productId)
    .populate({
      path: "store",
      select: PRODUCT_RESPONSE_POPULATE,
      match: { status: "active" },
    })
    .populate("category", "name status")
    .populate("mainVariant")
    .populate("productVariants");

const normalizeAttributes = (attributes) => {
  if (!attributes || typeof attributes !== "object") return {};
  return { ...attributes };
};

const normalizeVariantInput = (variantInput = {}) => {
  const normalizedVariant = {};

  if (variantInput.variantId !== undefined) normalizedVariant.variantId = variantInput.variantId;
  if (variantInput.attributes !== undefined)
    normalizedVariant.attributes = normalizeAttributes(variantInput.attributes);
  if (variantInput.price !== undefined) normalizedVariant.price = variantInput.price;
  if (variantInput.stock !== undefined) normalizedVariant.stock = variantInput.stock;
  if (variantInput.sku !== undefined) {
    normalizedVariant.sku =
      typeof variantInput.sku === "string" ? variantInput.sku.trim().toUpperCase() : variantInput.sku;
  }
  if (variantInput.imageUrl !== undefined) normalizedVariant.imageUrl = variantInput.imageUrl;
  if (variantInput.datasheet !== undefined) normalizedVariant.datasheet = variantInput.datasheet;
  if (variantInput.weight !== undefined) normalizedVariant.weight = variantInput.weight;
  if (variantInput.length !== undefined) normalizedVariant.length = variantInput.length;
  if (variantInput.width !== undefined) normalizedVariant.width = variantInput.width;
  if (variantInput.height !== undefined) normalizedVariant.height = variantInput.height;

  return normalizedVariant;
};

const extractProductPayload = (payload = {}) => {
  const productPayload = {};

  for (const field of PRODUCT_FIELDS) {
    if (payload[field] !== undefined) {
      productPayload[field] = field === "category" ? [payload[field]] : payload[field];
    }
  }

  return productPayload;
};

const extractMainVariantPayload = (payload = {}) => {
  if (!payload.mainVariant) {
    return null;
  }

  return normalizeVariantInput(payload.mainVariant);
};

const extractExtraVariantsPayload = (payload = {}) => {
  if (!Array.isArray(payload.variants)) {
    return [];
  }

  return payload.variants.map((variantInput) => normalizeVariantInput(variantInput));
};

const extractRemoveVariantIds = (payload = {}) => {
  if (!Array.isArray(payload.removeVariantIds)) {
    return [];
  }

  return [...new Set(payload.removeVariantIds.filter(Boolean).map((variantId) => variantId.toString()))];
};

const cleanupCreatedProduct = async (productId) => {
  await ProductVariant.deleteMany({ product: productId });
  await Product.findByIdAndDelete(productId);
};

const syncProductVariants = async (productId, mainVariantPayload, extraVariantsPayload = [], removeVariantIds = []) => {
  if (mainVariantPayload) {
    const mainVariant = await ProductVariant.findOne({ product: productId, isMainVariant: true });

    if (mainVariant) {
      Object.assign(mainVariant, mainVariantPayload, { isMainVariant: true, product: productId });
      await mainVariant.save();
    } else {
      await ProductVariant.create({
        ...mainVariantPayload,
        product: productId,
        isMainVariant: true,
      });
    }
  }

  if (removeVariantIds.length > 0) {
    await ProductVariant.deleteMany({
      _id: { $in: removeVariantIds },
      product: productId,
      isMainVariant: false,
    });
  }

  for (const variantPayload of extraVariantsPayload) {
    if (variantPayload.variantId) {
      const existingVariant = await ProductVariant.findOne({
        _id: variantPayload.variantId,
        product: productId,
        isMainVariant: false,
      });

      if (!existingVariant) {
        throw createHttpError("Variação do produto não encontrada", 404, undefined, "PRODUCT_VARIANT_NOT_FOUND");
      }

      const { variantId, ...variantData } = variantPayload;
      Object.assign(existingVariant, variantData, { product: productId, isMainVariant: false });
      await existingVariant.save();
      continue;
    }

    const { variantId, ...variantData } = variantPayload;

    await ProductVariant.create({
      ...variantData,
      product: productId,
      isMainVariant: false,
    });
  }
};

export const getVisibleProducts = async ({ categoryId } = {}) => {
  const activeStoreIds = await Store.find({ status: "active" }).distinct("_id");

  if (activeStoreIds.length === 0) {
    return [];
  }

  const filters = {
    status: "active",
    store: { $in: activeStoreIds },
  };

  if (categoryId) {
    filters.category = categoryId;
  }

  return Product.find(filters)
    .populate({
      path: "store",
      select: "name slug owner status",
      match: { status: "active" },
    })
    .populate("category", "name status")
    .populate("mainVariant")
    .populate("productVariants");
};

export const getProduct = async (productId) => {
  const product = await Product.findOne({ _id: productId, status: "active" })
    .populate("store", "name reputation")
    .populate("category", "name status")
    .populate("mainVariant")
    .populate("productVariants");

  if (!product) {
    throw createHttpError("Produto não encontrado", 404, undefined, "PRODUCT_NOT_FOUND");
  }

  return product;
};

export const findProductVariantByIdOrThrow = async (variantId) => {
  const variant = await ProductVariant.findOne({ _id: variantId }).populate({
    path: "product",
    select: "name description basePrice mainImageUrl highlighted maxPerPerson status store category",
    match: { status: { $ne: "deleted" } },
    populate: [
      {
        path: "store",
        select: "name slug owner status",
        match: { status: { $ne: "deleted" } },
      },
      {
        path: "category",
        select: "name status",
      },
    ],
  });

  if (!variant || !variant.product || !variant.product.store) {
    throw createHttpError("Variação não encontrada", 404, undefined, "PRODUCT_VARIANT_NOT_FOUND");
  }

  return variant;
};

export const createStores = async (id, data) => {
  const { name, description, logoUrl } = data;
  const existingStore = await Store.findOne({ owner: id, status: { $ne: "deleted" } });
  if (existingStore) {
    throw createHttpError("Este seller já possui uma loja", 409, undefined, "STORE_ALREADY_EXISTS");
  }

  const deletedStore = await Store.findOne({ owner: id, status: "deleted" }).sort({ updatedAt: -1 });

  if (deletedStore) {
    deletedStore.name = name;
    deletedStore.description = description ?? "";
    deletedStore.logoUrl = logoUrl ?? "";
    deletedStore.status = "active";

    const slugSaved = await saveDocumentWithUniqueSlug({
      document: deletedStore,
      sourceValue: name,
      maxRetries: MAX_SLUG_RETRIES,
    });
    if (!slugSaved) {
      throw createHttpError("Não foi possível gerar um slug único para a loja", 409, undefined, "STORE_SLUG_CONFLICT");
    }

    return deletedStore;
  }

  let store;
  try {
    store = await createDocumentWithUniqueSlug({
      Model: Store,
      payload: {
        name: name,
        description: description,
        logoUrl: logoUrl,
        owner: id,
      },
      sourceValue: name,
      maxRetries: MAX_SLUG_RETRIES,
    });
  } catch (err) {
    if (isDuplicateFieldError(err, "owner")) {
      throw createHttpError("Este seller já possui uma loja", 409, undefined, "STORE_ALREADY_EXISTS");
    }

    throw err;
  }

  if (!store) {
    throw createHttpError("Não foi possível gerar um slug único para a loja", 409, undefined, "STORE_SLUG_CONFLICT");
  }

  return store;
};

export const updateStoreForOwner = async (ownerId, data) => {
  const { name, description, logoUrl } = data;
  const store = await findActiveStoreByOwnerOrThrow(ownerId);

  if (description !== undefined) store.description = description;
  if (logoUrl !== undefined) store.logoUrl = logoUrl;

  if (name && name !== store.name) {
    store.name = name;

    const slugSaved = await saveDocumentWithUniqueSlug({
      document: store,
      sourceValue: name,
      maxRetries: MAX_SLUG_RETRIES,
    });

    if (!slugSaved) {
      throw createHttpError("Não foi possível gerar um slug único para a loja", 409, undefined, "STORE_SLUG_CONFLICT");
    }

    return store;
  }

  if (description !== undefined || logoUrl !== undefined) {
    await store.save();
  }

  return store;
};

export const findActiveStoreOrThrow = async (storeId) => {
  const store = await Store.findOne({ _id: storeId, status: { $ne: "deleted" } });

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
  }

  return store;
};

export const findActiveStoreByOwner = async (ownerId) => {
  return Store.findOne({ owner: ownerId, status: "active" });
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

export const listVisibleStores = async ({ categoryId } = {}) => {
  const filters = { status: "active" };

  if (categoryId) {
    filters.categories = categoryId;
  }

  return Store.find(filters).sort({ createdAt: -1 });
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
  const productPayload = extractProductPayload(payload);
  const mainVariantPayload = extractMainVariantPayload(payload);
  const extraVariantsPayload = extractExtraVariantsPayload(payload);
  const removeVariantIds = extractRemoveVariantIds(payload);

  if (!mainVariantPayload) {
    throw createHttpError("A variação principal é obrigatória", 400, undefined, "PRODUCT_MAIN_VARIANT_REQUIRED");
  }

  const product = new Product({
    ...productPayload,
    basePrice: mainVariantPayload.price,
    mainImageUrl: mainVariantPayload.imageUrl,
    store: storeId,
  });

  await product.save();

  try {
    await syncProductVariants(product._id, mainVariantPayload, extraVariantsPayload, removeVariantIds);
    return populateProductById(product._id);
  } catch (error) {
    await cleanupCreatedProduct(product._id);
    throw error;
  }
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
  const productPayload = extractProductPayload(payload);
  const mainVariantPayload = extractMainVariantPayload(payload);
  const extraVariantsPayload = extractExtraVariantsPayload(payload);
  const removeVariantIds = extractRemoveVariantIds(payload);

  if (mainVariantPayload?.price !== undefined) {
    productPayload.basePrice = mainVariantPayload.price;
  }

  if (mainVariantPayload?.imageUrl !== undefined) {
    productPayload.mainImageUrl = mainVariantPayload.imageUrl;
  }

  if (Object.keys(productPayload).length > 0) {
    Object.assign(product, productPayload);
    await product.save();
  }

  if (mainVariantPayload || extraVariantsPayload.length > 0 || removeVariantIds.length > 0) {
    await syncProductVariants(product._id, mainVariantPayload, extraVariantsPayload, removeVariantIds);
  }

  return populateProductById(product._id);
};

export const softDeleteProduct = async (productId) => {
  await Product.findByIdAndUpdate(productId, { status: "deleted" });
};
