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
  return {
    attributes: normalizeAttributes(variantInput.attributes),
    price: variantInput.price,
    stock: variantInput.stock,
    sku: typeof variantInput.sku === "string" ? variantInput.sku.trim().toUpperCase() : variantInput.sku,
    imageUrl: variantInput.imageUrl,
    datasheet: variantInput.datasheet ?? null,
    weight: variantInput.weight ?? null,
    length: variantInput.length ?? null,
    width: variantInput.width ?? null,
    height: variantInput.height ?? null,
  };
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
  if (payload.mainVariant) {
    return normalizeVariantInput(payload.mainVariant);
  }

  const hasLegacyVariantField = VARIANT_FIELDS.some((field) => payload[field] !== undefined);
  if (!hasLegacyVariantField) {
    return null;
  }

  return normalizeVariantInput(payload);
};

const extractExtraVariantsPayload = (payload = {}) => {
  if (!Array.isArray(payload.variants)) {
    return [];
  }

  return payload.variants.map((variantInput) => normalizeVariantInput(variantInput));
};

const cleanupCreatedProduct = async (productId) => {
  await ProductVariant.deleteMany({ product: productId });
  await Product.findByIdAndDelete(productId);
};

const syncProductVariants = async (productId, mainVariantPayload, extraVariantsPayload = []) => {
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

  for (const variantPayload of extraVariantsPayload) {
    if (variantPayload._id) {
      const existingVariant = await ProductVariant.findOne({
        _id: variantPayload._id,
        product: productId,
        isMainVariant: false,
      });

      if (!existingVariant) {
        throw createHttpError("Variação do produto não encontrada", 404, undefined, "PRODUCT_VARIANT_NOT_FOUND");
      }

      Object.assign(existingVariant, variantPayload, { product: productId, isMainVariant: false });
      await existingVariant.save();
      continue;
    }

    await ProductVariant.create({
      ...variantPayload,
      product: productId,
      isMainVariant: false,
    });
  }
};

export const getVisibleProducts = async () => {
  const activeStoreIds = await Store.find({ status: "active" }).distinct("_id");

  if (activeStoreIds.length === 0) {
    return [];
  }

  return Product.find({
    status: "active",
    store: { $in: activeStoreIds },
  })
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
    await syncProductVariants(product._id, mainVariantPayload, extraVariantsPayload);
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

  if (mainVariantPayload || extraVariantsPayload.length > 0) {
    await syncProductVariants(product._id, mainVariantPayload, extraVariantsPayload);
  }

  return populateProductById(product._id);
};

export const softDeleteProduct = async (productId) => {
  await Product.findByIdAndUpdate(productId, { status: "deleted" });
};
