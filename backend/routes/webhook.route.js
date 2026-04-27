import { Router } from "express";
import { handleWebhook } from "../controllers/shipping.controller.js";
import { webhookAuthMiddleware } from "../helpers/melhorenvioSignature.helper.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { shippingWebhookBodySchema } from "../validators/shipping.validator.js";

const router = Router();

router.get("/melhorenvio/events", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Webhook endpoint disponível",
  });
});

router.post(
  "/melhorenvio/events",
  webhookAuthMiddleware,
  validateBody(shippingWebhookBodySchema),
  handleWebhook,
);

export default router;
