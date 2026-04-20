import { sendSuccess } from "../helpers/successResponse.js";
import {
  createCategory,
  findCategoryByIdOrThrow,
  listActiveCategories,
  listCategoriesForAdmin,
  softDeleteCategoryById,
  updateCategoryById,
} from "../services/category.service.js";

export const getAllCategoriesForAdmin = async (req, res, next) => {
  try {
    const { status, search, page, limit } = req.validatedQuery ?? {};
    const categories = await listCategoriesForAdmin({ status, search, page, limit });
    return sendSuccess(res, 200, "Categorias listadas com sucesso", categories);
  } catch (error) {
    return next(error);
  }
};

export const getAllCategories = async (req, res, next) => {
  try {
    const { page, limit } = req.validatedQuery ?? {};
    const categories = await listActiveCategories({ page, limit });
    return sendSuccess(res, 200, "Categorias listadas com sucesso", categories);
  } catch (error) {
    return next(error);
  }
};

export const getCategoryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await findCategoryByIdOrThrow(id);
    return sendSuccess(res, 200, "Categoria encontrada com sucesso", category);
  } catch (error) {
    return next(error);
  }
};

export const createCategoryByAdmin = async (req, res, next) => {
  try {
    const category = await createCategory(req.body);
    return sendSuccess(res, 201, "Categoria criada com sucesso", category);
  } catch (error) {
    return next(error);
  }
};

export const updateCategoryByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await updateCategoryById(id, req.body);
    return sendSuccess(res, 200, "Categoria atualizada com sucesso", category);
  } catch (error) {
    return next(error);
  }
};

export const deleteCategoryByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    await softDeleteCategoryById(id);
    return sendSuccess(res, 200, "Categoria deletada com sucesso");
  } catch (error) {
    return next(error);
  }
};
