import express from "express";
import {
  getShippingOptions,
  selectShippingOption,
  generateLabel,
  getLabelUrl,
  initiateOAuth,
  oauthCallback,
} from "../controllers/shipping.controller.js";
import {
  shippingOAuthCallbackQuerySchema,
  shippingOptionsQuerySchema,
  shippingSubOrderParamSchema,
  selectShippingBodySchema,
} from "../validators/shipping.validator.js";
import { isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";

const router = express.Router();

/**
 * Rota pública para OAuth callback (sem autenticação)
 */
router.get("/auth/callback", validateQuery(shippingOAuthCallbackQuerySchema), oauthCallback);

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
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  validateQuery(shippingOptionsQuerySchema),
  getShippingOptions,
);

/**
 * POST /api/stores/me/orders/:subOrderId/shipping/select
 * Seleciona transportadora
 */
router.post(
  "/orders/:subOrderId/shipping/select",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  validateBody(selectShippingBodySchema),
  selectShippingOption,
);

/**
 * POST /api/stores/me/orders/:subOrderId/shipping/label
 * Gera etiqueta no MelhorEnvio
 */
router.post(
  "/orders/:subOrderId/shipping/label",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  generateLabel,
);

/**
 * GET /api/stores/me/orders/:subOrderId/shipping/label
 * Retorna a URL da etiqueta já gerada
 */
router.get(
  "/orders/:subOrderId/shipping/label",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  getLabelUrl,
);

/**
 * GET /api/shipping/auth/authorize?storeId=...
 * Inicia fluxo OAuth2
 */
router.get("/auth/authorize", isLoggedIn, isSeller, initiateOAuth);

export default router;
