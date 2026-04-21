import shippingService from "../services/shipping.service.js";
import melhorenvioService from "../services/melhorenvio.service.js";
import MelhorEnvioAuth from "../models/melhorEnvioAuth.model.js";
import Store from "../models/store.model.js";
import { sendSuccess } from "../helpers/successResponse.js";

/**
 * Controllers para endpoints de shipping
 */

/**
 * Obtém opções de frete (cotação)
 * GET /api/shipping/:subOrderId/options
 */
export const getShippingOptions = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;
    const { forceRecalculate } = req.query;

    const options = await shippingService.getShippingOptions(
      subOrderId,
      forceRecalculate === "true",
    );

    return sendSuccess(res, 200, "Opções de frete obtidas com sucesso", options);
  } catch (error) {
    return next(error);
  }
};

/**
 * Seleciona transportadora
 * POST /api/shipping/:subOrderId/select
 */
export const selectShippingOption = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;
    const { carrierId, quoteId } = req.body;

    const result = await shippingService.selectShippingOption(
      subOrderId,
      carrierId,
      quoteId,
    );

    return sendSuccess(res, 200, "Transportadora selecionada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Gera etiqueta de envio
 * POST /api/shipping/:subOrderId/label
 */
export const generateLabel = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;

    const label = await shippingService.generateLabel(subOrderId);

    return sendSuccess(res, 201, "Etiqueta gerada com sucesso", label);
  } catch (error) {
    return next(error);
  }
};

/**
 * Inicia processo OAuth2 com MelhorEnvio
 * GET /api/shipping/auth/authorize
 */
export const initiateOAuth = async (req, res, next) => {
  try {
    const { storeId } = req.query;

    if (!storeId) {
      const error = new Error("storeId é obrigatório");
      error.status = 400;
      error.errorCode = "STORE_ID_REQUIRED";
      throw error;
    }

    const authUrl = melhorenvioService.generateAuthorizationUrl(storeId);

    return sendSuccess(res, 200, "URL de autorização gerada", { authUrl });
  } catch (error) {
    return next(error);
  }
};

/**
 * Callback OAuth2 - troca code por token
 * GET /api/shipping/auth/callback?code=...&state=...
 */
export const oauthCallback = async (req, res) => {
  try {
    const { code, state: storeId } = req.query;

    if (!code || !storeId) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_OAUTH_CALLBACK",
        message: "code e state são obrigatórios",
      });
    }

    // Trocar code por token
    const { accessToken, refreshToken, expiresIn } =
      await melhorenvioService.exchangeCodeForToken(code);

    // Salvar credenciais
    const store = await Store.findById(storeId).select("owner").lean();
    if (!store) {
      return res.status(404).json({
        success: false,
        errorCode: "STORE_NOT_FOUND",
        message: "Loja não encontrada para vincular autenticação",
      });
    }

    await MelhorEnvioAuth.findOneAndUpdate(
      { store: storeId },
      {
        store: storeId,
        user: store.owner,
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        lastRefreshed: new Date(),
        isActive: true,
      },
      { upsert: true, new: true },
    );

    // Redirecionar para dashboard do seller
    return res.redirect(
      `/dashboard/stores/${storeId}/shipping?authenticated=true`,
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      errorCode: error.errorCode || "OAUTH_FAILED",
      message: error.message,
      details: error.details,
    });
  }
};

/**
 * Webhook: recebe atualizações de status do MelhorEnvio
 * POST /api/webhooks/melhorenvio/events
 */
export const handleWebhook = async (req, res) => {
  try {
    const { event, data } = req.body;

    // Validar assinatura HMAC-SHA256
    // TODO: implementar verificação de X-ME-Signature

    // Map de eventos
    const eventHandlers = {
      "order.created": async () => {
        // Label criada no carrinho
        return { processed: true };
      },
      "order.posted": async () => {
        // Postada
        await shippingService.updateLabelStatus(data.id, "posted");
      },
      "order.delivered": async () => {
        // Entregue
        await shippingService.updateLabelStatus(data.id, "delivered");
      },
      "order.cancelled": async () => {
        await shippingService.updateLabelStatus(data.id, "cancelled");
      },
      "order.undelivered": async () => {
        await shippingService.updateLabelStatus(data.id, "undelivered");
      },
      "order.paused": async () => {
        await shippingService.updateLabelStatus(data.id, "paused");
      },
      "order.suspended": async () => {
        await shippingService.updateLabelStatus(data.id, "suspended");
      },
    };

    const handler = eventHandlers[event];
    if (!handler) {
      console.warn(`[Webhook] Evento desconhecido: ${event}`);
      return res.status(200).json({ received: true }); // MelhorEnvio quer 200 rápido
    }

    await handler();

    // MelhorEnvio quer resposta rápida (< 6s)
    return res.status(200).json({
      success: true,
      message: "Webhook processado",
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[Webhook Error]:", error);
    // Sempre retornar 200 para MelhorEnvio não ficar tentando novamente
    return res.status(200).json({
      success: false,
      message: "Erro ao processar webhook",
      errorCode: error.errorCode || "WEBHOOK_ERROR",
    });
  }
};
