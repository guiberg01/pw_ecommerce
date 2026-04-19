import Category from "../models/category.model.js";
import Product from "../models/product.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { createDocumentWithUniqueSlug, saveDocumentWithUniqueSlug } from "../helpers/slugUnique.helper.js";

const MAX_SLUG_RETRIES = 5;

export const listActiveCategories = async () => {
  return Category.find({ status: "active" }).sort({ name: 1 });
};

export const findCategoryByIdOrThrow = async (categoryId, { includeInactive = false } = {}) => {
  const statusFilter = includeInactive ? { $ne: "deleted" } : "active";
  const category = await Category.findOne({ _id: categoryId, status: statusFilter });

  if (!category) {
    throw createHttpError("Categoria não encontrada", 404, undefined, "CATEGORY_NOT_FOUND");
  }

  return category;
};

export const createCategory = async ({ name }) => {
  const normalizedName = name.trim();

  const deletedCategory = await Category.findOne({ name: normalizedName, status: "deleted" }).sort({ updatedAt: -1 });
  if (deletedCategory) {
    deletedCategory.name = normalizedName;
    deletedCategory.status = "active";

    const slugSaved = await saveDocumentWithUniqueSlug({
      document: deletedCategory,
      sourceValue: normalizedName,
      maxRetries: MAX_SLUG_RETRIES,
    });

    if (!slugSaved) {
      throw createHttpError(
        "Não foi possível gerar um slug único para a categoria",
        409,
        undefined,
        "CATEGORY_SLUG_CONFLICT",
      );
    }

    return deletedCategory;
  }

  const category = await createDocumentWithUniqueSlug({
    Model: Category,
    payload: {
      name: normalizedName,
      status: "active",
    },
    sourceValue: normalizedName,
    maxRetries: MAX_SLUG_RETRIES,
  });

  if (!category) {
    throw createHttpError(
      "Não foi possível gerar um slug único para a categoria",
      409,
      undefined,
      "CATEGORY_SLUG_CONFLICT",
    );
  }

  return category;
};

export const updateCategoryById = async (categoryId, payload) => {
  const category = await findCategoryByIdOrThrow(categoryId, { includeInactive: true });

  if (payload.status === "deleted") {
    throw createHttpError(
      "Use o endpoint de exclusão para deletar categoria",
      400,
      undefined,
      "CATEGORY_DELETE_VIA_UPDATE_FORBIDDEN",
    );
  }

  if (payload.status !== undefined) {
    category.status = payload.status;
  }

  if (payload.name !== undefined && payload.name.trim() !== category.name) {
    category.name = payload.name.trim();

    const slugSaved = await saveDocumentWithUniqueSlug({
      document: category,
      sourceValue: category.name,
      maxRetries: MAX_SLUG_RETRIES,
    });

    if (!slugSaved) {
      throw createHttpError(
        "Não foi possível gerar um slug único para a categoria",
        409,
        undefined,
        "CATEGORY_SLUG_CONFLICT",
      );
    }

    return category;
  }

  if (payload.status !== undefined) {
    await category.save();
  }

  return category;
};

export const softDeleteCategoryById = async (categoryId) => {
  const category = await findCategoryByIdOrThrow(categoryId, { includeInactive: true });

  if (category.status === "deleted") {
    throw createHttpError("Categoria já está deletada", 400, undefined, "CATEGORY_ALREADY_DELETED");
  }

  const [activeProductsCount, activeStoresCount] = await Promise.all([
    Product.countDocuments({ category: category._id, status: { $ne: "deleted" } }),
    Store.countDocuments({ categories: category._id, status: { $ne: "deleted" } }),
  ]);

  if (activeProductsCount > 0 || activeStoresCount > 0) {
    throw createHttpError(
      "Não é possível excluir categoria com vínculos ativos",
      409,
      {
        activeProductsCount,
        activeStoresCount,
      },
      "CATEGORY_HAS_ACTIVE_REFERENCES",
    );
  }

  category.status = "deleted";
  await category.save();

  return category;
};
