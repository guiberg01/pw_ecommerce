import Category from "../models/category.model.js";
import Product from "../models/product.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { createDocumentWithUniqueSlug, saveDocumentWithUniqueSlug } from "../helpers/slugUnique.helper.js";
import { categoryStatuses } from "../constants/categoryStatuses.js";

const MAX_SLUG_RETRIES = 5;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const normalizePagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limit)))
    : DEFAULT_LIMIT;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
  };
};

const buildPaginationResult = (items, total, page, limit) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  },
});

export const listActiveCategories = async ({ page, limit } = {}) => {
  const pagination = normalizePagination({ page, limit });
  const skip = (pagination.page - 1) * pagination.limit;
  const filters = { status: categoryStatuses.ACTIVE };

  const [items, total] = await Promise.all([
    Category.find(filters).sort({ name: 1 }).skip(skip).limit(pagination.limit),
    Category.countDocuments(filters),
  ]);

  return buildPaginationResult(items, total, pagination.page, pagination.limit);
};

export const listCategoriesForAdmin = async ({ status, search, page = 1, limit = 20 } = {}) => {
  const filters = {};

  if (status) {
    filters.status = status;
  }

  if (search) {
    filters.name = { $regex: search, $options: "i" };
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Category.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Category.countDocuments(filters),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const findCategoryByIdOrThrow = async (categoryId, { includeInactive = false } = {}) => {
  const filters = { _id: categoryId };
  const query = Category.findOne(filters);
  
  if (includeInactive) {
    query.setOptions({ includeDeleted: true });
  }

  const category = await query;

  if (!category) {
    throw createHttpError("Categoria não encontrada", 404, undefined, "CATEGORY_NOT_FOUND");
  }

  return category;
};

export const createCategory = async ({ name }) => {
  const normalizedName = name.trim();

  const deletedCategory = await Category.findOne({ name: normalizedName }).setOptions({ includeDeleted: true }).sort({ updatedAt: -1 });
  if (deletedCategory) {
    deletedCategory.name = normalizedName;
    deletedCategory.status = categoryStatuses.ACTIVE;
    deletedCategory.deletedAt = null;

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
      status: categoryStatuses.ACTIVE,
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

  if (category.deletedAt !== null) {
    throw createHttpError("Categoria já está deletada", 400, undefined, "CATEGORY_ALREADY_DELETED");
  }

  const [activeProductsCount, activeStoresCount] = await Promise.all([
    Product.countDocuments({ category: category._id }),
    Store.countDocuments({ categories: category._id }),
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

  category.deletedAt = new Date();
  await category.save();

  return category;
};
