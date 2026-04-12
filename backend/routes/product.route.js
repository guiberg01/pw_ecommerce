import { Router } from "express";
import { allProducts, updateProduct, deleteProduct } from "../controllers/product.controller.js";
import { isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { productIdParamSchema, updateProductSchema } from "../validators/product.validator.js";

const router = Router();

router.get("/", allProducts);

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
