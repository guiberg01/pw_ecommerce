import { Router } from "express";
import { createStore, getMyStore, getStoreById, updateMyStore } from "../controllers/store.controller.js";
import { createProductForMyStore } from "../controllers/product.controller.js";
import { isLoggedIn, isSellerOrAdmin } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { createProductSchema } from "../validators/product.validator.js";

const router = Router();

router.post("/", isLoggedIn, isSellerOrAdmin, createStore);
router.get("/me", isLoggedIn, isSellerOrAdmin, getMyStore);
router.put("/me", isLoggedIn, isSellerOrAdmin, updateMyStore);
router.post("/me/products", isLoggedIn, isSellerOrAdmin, validateBody(createProductSchema), createProductForMyStore);
router.get("/:storeId", getStoreById);

export default router;
