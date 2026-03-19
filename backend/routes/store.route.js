import { Router } from "express";
import {
  allStoresForAdmin,
  createStore,
  getMyStore,
  getStoreById,
  updateMyStore,
  deleteStore,
} from "../controllers/store.controller.js";
import { createProductForMyStore } from "../controllers/product.controller.js";
import { isAdmin, isLoggedIn, isSellerOrAdmin } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { createProductSchema } from "../validators/product.validator.js";
import { createStoreSchema, storeIdParamSchema, updateStoreSchema } from "../validators/store.validator.js";

const router = Router();

router.get("/", isLoggedIn, isAdmin, allStoresForAdmin);
router.post("/", isLoggedIn, isSellerOrAdmin, validateBody(createStoreSchema), createStore);

router.get("/me", isLoggedIn, isSellerOrAdmin, getMyStore);
router.put("/me", isLoggedIn, isSellerOrAdmin, validateBody(updateStoreSchema), updateMyStore);
router.post("/me/products", isLoggedIn, isSellerOrAdmin, validateBody(createProductSchema), createProductForMyStore);

router.get("/:storeId", validateParams(storeIdParamSchema), getStoreById);

router.delete("/:storeId", isLoggedIn, isSellerOrAdmin, validateParams(storeIdParamSchema), deleteStore);

export default router;
