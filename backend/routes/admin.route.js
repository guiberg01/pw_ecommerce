import { Router } from "express";
import {
  allStoresForAdmin,
  createProductForStoreByAdmin,
  deleteStoreByAdmin,
  updateProductByAdmin,
  deleteProductByAdmin,
  updateStoreStatusByAdmin,
} from "../controllers/admin.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import { createProductSchema, productIdParamSchema, updateProductSchema } from "../validators/product.validator.js";
import { storeIdParamSchema, storeListQuerySchema, updateStoreStatusByAdminSchema } from "../validators/store.validator.js";

const router = Router();

router.get("/stores", isLoggedIn, isAdmin, validateQuery(storeListQuerySchema), allStoresForAdmin);
router.post(
  "/stores/:storeId/products",
  isLoggedIn,
  isAdmin,
  validateParams(storeIdParamSchema),
  validateBody(createProductSchema),
  createProductForStoreByAdmin,
);
router.put(
  "/stores/:storeId/status",
  isLoggedIn,
  isAdmin,
  validateParams(storeIdParamSchema),
  validateBody(updateStoreStatusByAdminSchema),
  updateStoreStatusByAdmin,
);
router.delete("/stores/:storeId", isLoggedIn, isAdmin, validateParams(storeIdParamSchema), deleteStoreByAdmin);
router.put(
  "/products/:id",
  isLoggedIn,
  isAdmin,
  validateParams(productIdParamSchema),
  validateBody(updateProductSchema),
  updateProductByAdmin,
);
router.delete("/products/:id", isLoggedIn, isAdmin, validateParams(productIdParamSchema), deleteProductByAdmin);

export default router;
