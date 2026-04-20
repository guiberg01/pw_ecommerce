import { Router } from "express";
import {
  createCategoryByAdmin,
  deleteCategoryByAdmin,
  getAllCategories,
  getAllCategoriesForAdmin,
  getCategoryById,
  updateCategoryByAdmin,
} from "../controllers/category.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import {
  categoryAdminListQuerySchema,
  categoryIdParamSchema,
  categoryListQuerySchema,
  createCategorySchema,
  updateCategorySchema,
} from "../validators/category.validator.js";

const router = Router();

router.get("/", validateQuery(categoryListQuerySchema), getAllCategories);
router.get("/admin", isLoggedIn, isAdmin, validateQuery(categoryAdminListQuerySchema), getAllCategoriesForAdmin);
router.get("/:id", validateParams(categoryIdParamSchema), getCategoryById);
router.post("/", isLoggedIn, isAdmin, validateBody(createCategorySchema), createCategoryByAdmin);
router.put(
  "/:id",
  isLoggedIn,
  isAdmin,
  validateParams(categoryIdParamSchema),
  validateBody(updateCategorySchema),
  updateCategoryByAdmin,
);
router.delete("/:id", isLoggedIn, isAdmin, validateParams(categoryIdParamSchema), deleteCategoryByAdmin);

export default router;
