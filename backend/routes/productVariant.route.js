import { Router } from "express";
import { getProductVariantById } from "../controllers/productVariant.controller.js";
import { validateParams } from "../middleware/validation.middleware.js";
import { productVariantIdParamSchema } from "../validators/product.validator.js";

const router = Router();

router.get("/:id", validateParams(productVariantIdParamSchema), getProductVariantById);

export default router;
