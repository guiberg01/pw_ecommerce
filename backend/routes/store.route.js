import { Router } from "express";
import {
  allStores,
  createStore,
  createMyStoreStripeOnboardingLink,
  getMyStoreStripeConnectStatus,
  getMyStore,
  getStoreById,
  updateMyStore,
  deleteMyStore,
} from "../controllers/store.controller.js";
import { createProductForMyStore } from "../controllers/product.controller.js";
import { isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import { createProductSchema } from "../validators/product.validator.js";
import {
  createStoreSchema,
  storeIdParamSchema,
  storeListQuerySchema,
  stripeOnboardingLinkSchema,
  updateMyStoreSchema,
} from "../validators/store.validator.js";

const router = Router();

router.post("/", isLoggedIn, isSeller, validateBody(createStoreSchema), createStore);
router.get("/", validateQuery(storeListQuerySchema), allStores);

router.get("/me", isLoggedIn, isSeller, getMyStore);
router.put("/me", isLoggedIn, isSeller, validateBody(updateMyStoreSchema), updateMyStore);
router.get("/me/stripe/status", isLoggedIn, isSeller, getMyStoreStripeConnectStatus);
router.post(
  "/me/stripe/onboarding-link",
  isLoggedIn,
  isSeller,
  validateBody(stripeOnboardingLinkSchema),
  createMyStoreStripeOnboardingLink,
);
router.post("/me/products", isLoggedIn, isSeller, validateBody(createProductSchema), createProductForMyStore);
router.get("/:storeId", validateParams(storeIdParamSchema), getStoreById);
router.delete("/:storeId", isLoggedIn, isSeller, validateParams(storeIdParamSchema), deleteMyStore);

export default router;
