import { Router } from "express";
import {
  createCategoryByAdmin,
  deleteCategoryByAdmin,
  getAllCategories,
  getCategoryById,
  updateCategoryByAdmin,
} from "../controllers/category.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { categoryIdParamSchema, createCategorySchema, updateCategorySchema } from "../validators/category.validator.js";

const router = Router();

router.get("/", getAllCategories);
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
