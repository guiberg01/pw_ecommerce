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
 * Padrão real (mount em /api/shipping): /api/shipping/orders/:subOrderId/*
 */

/**
 * GET /api/shipping/orders/:subOrderId/options
 * Obtém opções de frete para um subOrder
 */
router.get(
  "/orders/:subOrderId/options",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  validateQuery(shippingOptionsQuerySchema),
  getShippingOptions,
);

/**
 * POST /api/shipping/orders/:subOrderId/select
 * Seleciona transportadora
 */
router.post(
  "/orders/:subOrderId/select",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  validateBody(selectShippingBodySchema),
  selectShippingOption,
);

/**
 * POST /api/shipping/orders/:subOrderId/label
 * Gera etiqueta no MelhorEnvio
 */
router.post(
  "/orders/:subOrderId/label",
  isLoggedIn,
  isSeller,
  validateParams(shippingSubOrderParamSchema),
  generateLabel,
);

/**
 * GET /api/shipping/orders/:subOrderId/label
 * Retorna a URL da etiqueta já gerada
 */
router.get(
  "/orders/:subOrderId/label",
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
