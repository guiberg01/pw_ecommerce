import { Router } from "express";
import { allProducts, getProductById, updateProduct, deleteProduct } from "../controllers/product.controller.js";
import { isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import { productIdParamSchema, productListQuerySchema, updateProductSchema } from "../validators/product.validator.js";

const router = Router();

router.get("/", validateQuery(productListQuerySchema), allProducts);
router.get("/:id", validateParams(productIdParamSchema), getProductById);
router.delete("/:id", isLoggedIn, isSeller, validateParams(productIdParamSchema), deleteProduct);
router.put(
  "/:id",
  isLoggedIn,
  isSeller,
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  updateProduct,
);

export default router;
