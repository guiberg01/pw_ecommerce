import { Router } from "express";
import {
  createStore,
  getMyStore,
  getStoreById,
  updateMyStore,
  deleteMyStore,
} from "../controllers/store.controller.js";
import { createProductForMyStore } from "../controllers/product.controller.js";
import { isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { createProductSchema } from "../validators/product.validator.js";
import { createStoreSchema, storeIdParamSchema, updateMyStoreSchema } from "../validators/store.validator.js";

const router = Router();

router.post("/", isLoggedIn, isSeller, validateBody(createStoreSchema), createStore);

router.get("/me", isLoggedIn, isSeller, getMyStore);
router.put("/me", isLoggedIn, isSeller, validateBody(updateMyStoreSchema), updateMyStore);
router.post("/me/products", isLoggedIn, isSeller, validateBody(createProductSchema), createProductForMyStore);
router.get("/:storeId", validateParams(storeIdParamSchema), getStoreById);
router.delete("/:storeId", isLoggedIn, isSeller, validateParams(storeIdParamSchema), deleteMyStore);

export default router;
