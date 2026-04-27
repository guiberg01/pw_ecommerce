import { Router } from "express";
import {
  createCheckoutIntent,
  getCheckoutShippingOptions,
  handleStripeWebhook,
  reconcileCheckoutOrderPayment,
  resumeCheckoutIntent,
} from "../controllers/checkout.controller.js";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import {
  checkoutOrderIdParamSchema,
  checkoutShippingOptionsSchema,
  createCheckoutIntentSchema,
} from "../validators/checkout.validator.js";

const router = Router();

router.post("/webhook/stripe", handleStripeWebhook);
router.post("/shipping-options", isLoggedIn, validateBody(checkoutShippingOptionsSchema), getCheckoutShippingOptions);
router.post("/intent", isLoggedIn, validateBody(createCheckoutIntentSchema), createCheckoutIntent);
router.get("/intent/:orderId/resume", isLoggedIn, validateParams(checkoutOrderIdParamSchema), resumeCheckoutIntent);
router.post(
  "/orders/:orderId/reconcile",
  isLoggedIn,
  validateParams(checkoutOrderIdParamSchema),
  reconcileCheckoutOrderPayment,
);

export default router;
