import { Router } from "express";
import { createCheckoutIntent, handleStripeWebhook } from "../controllers/checkout.controller.js";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { createCheckoutIntentSchema } from "../validators/checkout.validator.js";

const router = Router();

router.post("/webhook/stripe", handleStripeWebhook);
router.post("/intent", isLoggedIn, validateBody(createCheckoutIntentSchema), createCheckoutIntent);

export default router;
