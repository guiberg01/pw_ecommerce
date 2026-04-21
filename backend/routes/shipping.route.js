import express from "express";
import {
  getShippingOptions,
  selectShippingOption,
  generateLabel,
  initiateOAuth,
  oauthCallback,
  handleWebhook,
} from "../controllers/shipping.controller.js";
import {
  calculateShippingSchema,
  selectShippingSchema,
  generateLabelSchema,
  webhookSchema,
  oauthCallbackSchema,
  validateRequest,
} from "../validators/shipping.validator.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { webhookAuthMiddleware } from "../helpers/melhorenvioSignature.helper.js";

const router = express.Router();

/**
 * Rota pública para webhooks (sem autenticação)
 */
router.post(
  "/webhooks/melhorenvio/events",
  webhookAuthMiddleware,
  webhookSchema,
  validateRequest,
  handleWebhook,
);

/**
 * Rota pública para OAuth callback (sem autenticação)
 */
router.get("/auth/callback", oauthCallbackSchema, validateRequest, oauthCallback);

/**
 * Rotas de shipping (autenticadas como seller)
 * Padrão: todos os endpoints de shipping sob /api/stores/me/orders/:subOrderId/shipping
 */

/**
 * GET /api/stores/me/orders/:subOrderId/shipping/options
 * Obtém opções de frete para um subOrder
 */
router.get(
  "/orders/:subOrderId/shipping/options",
  authenticate,
  calculateShippingSchema,
  validateRequest,
  getShippingOptions,
);

/**
 * POST /api/stores/me/orders/:subOrderId/shipping/select
 * Seleciona transportadora
 */
router.post(
  "/orders/:subOrderId/shipping/select",
  authenticate,
  selectShippingSchema,
  validateRequest,
  selectShippingOption,
);

/**
 * POST /api/stores/me/orders/:subOrderId/shipping/label
 * Gera etiqueta no MelhorEnvio
 */
router.post(
  "/orders/:subOrderId/shipping/label",
  authenticate,
  generateLabelSchema,
  validateRequest,
  generateLabel,
);

/**
 * GET /api/shipping/auth/authorize?storeId=...
 * Inicia fluxo OAuth2
 */
router.get("/auth/authorize", initiateOAuth);

export default router;
