import { Router } from "express";
import { allProducts, updateProduct, deleteProduct } from "../controllers/product.controller.js";
import { isLoggedIn, isSellerOrAdmin } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { updateProductSchema } from "../validators/product.validator.js";

const router = Router();

router.get("/", allProducts);

router.delete("/:id", isLoggedIn, isSellerOrAdmin, deleteProduct);

router.put("/:id", isLoggedIn, isSellerOrAdmin, validateBody(updateProductSchema), updateProduct);

export default router;
