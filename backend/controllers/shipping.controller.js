import shippingService from "../services/shipping.service.js";
import melhorenvioService from "../services/melhorenvio.service.js";
import MelhorEnvioAuth from "../models/melhorEnvioAuth.model.js";
import Store from "../models/store.model.js";
import { sendSuccess } from "../helpers/successResponse.js";
import { createHttpError } from "../helpers/httpError.js";

const resolveSellerDashboardBaseUrl = () => {
  const candidates = [
    process.env.SELLER_DASHBOARD_BASE_URL,
    process.env.FRONTEND_BASE_URL,
    process.env.CLIENT_BASE_URL,
    process.env.WEB_BASE_URL,
  ];

  const raw = candidates.find((value) => String(value ?? "").trim());
  return raw ? String(raw).trim().replace(/\/$/, "") : null;
};

const isLocalDevelopmentUrl = (value) => {
  if (!value) return false;

  try {
    const parsedUrl = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsedUrl.hostname);
  } catch {
    return false;
  }
};

/**
 * Controllers para endpoints de shipping
 */

/**
 * Obtém opções de frete (cotação)
 * GET /api/shipping/orders/:subOrderId/options
 */
export const getShippingOptions = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;
    const { forceRecalculate } = req.query;

    const options = await shippingService.getShippingOptions(subOrderId, forceRecalculate === "true", req.user?._id);

    return sendSuccess(res, 200, "Opções de frete obtidas com sucesso", options);
  } catch (error) {
    return next(error);
  }
};

/**
 * Seleciona transportadora
 * POST /api/shipping/orders/:subOrderId/select
 */
export const selectShippingOption = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;
    const { carrierId, quoteId } = req.body;

    const result = await shippingService.selectShippingOption(subOrderId, carrierId, quoteId, req.user?._id);

    return sendSuccess(res, 200, "Transportadora selecionada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Gera etiqueta de envio
 * POST /api/shipping/orders/:subOrderId/label
 */
export const generateLabel = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;

    const label = await shippingService.generateLabel(subOrderId, req.user?._id);

    return sendSuccess(res, 201, "Etiqueta gerada com sucesso", label);
  } catch (error) {
    return next(error);
  }
};

/**
 * Obtém a URL da etiqueta já gerada
 * GET /api/shipping/orders/:subOrderId/label
 */
export const getLabelUrl = async (req, res, next) => {
  try {
    const { subOrderId } = req.params;

    const label = await shippingService.getLabelUrl(subOrderId, req.user?._id);

    return sendSuccess(res, 200, "URL da etiqueta obtida com sucesso", label);
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
      throw createHttpError("storeId é obrigatório", 400, undefined, "STORE_ID_REQUIRED");
    }

    const store = await Store.findById(storeId).select("_id owner").lean();
    if (!store) {
      throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
    }

    if (String(store.owner) !== String(req.user?._id ?? "")) {
      throw createHttpError("Acesso proibido para vincular esta loja", 403, undefined, "STORE_FORBIDDEN");
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
    const { code, state: storeId, error, error_description: errorDescription } = req.query;

    if (error || !code || !storeId) {
      return res.status(400).json({
        success: false,
        errorCode: error ? "MELHOR_ENVIO_OAUTH_ERROR" : "INVALID_OAUTH_CALLBACK",
        message: errorDescription || error || "OAuth do MelhorEnvio não retornou code/state válidos",
      });
    }

    // Trocar code por token
    const { accessToken, refreshToken, expiresIn } = await melhorenvioService.exchangeCodeForToken(code);

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

    const dashboardPath = `/dashboard/stores/${storeId}/shipping?authenticated=true`;
    const dashboardBaseUrl = resolveSellerDashboardBaseUrl();

    // Em desenvolvimento local, evitar redirecionamento automático para localhost.
    if (dashboardBaseUrl && !isLocalDevelopmentUrl(dashboardBaseUrl)) {
      return res.redirect(`${dashboardBaseUrl}${dashboardPath}`);
    }

    // Fallback seguro para evitar 404 em rota inexistente no backend.
    return res.status(200).json({
      success: true,
      message: "Autenticação com MelhorEnvio concluída com sucesso",
      data: {
        storeId,
        authenticated: true,
        dashboardPath,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      errorCode: error.code || "OAUTH_FAILED",
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
      errorCode: error.code || "WEBHOOK_ERROR",
    });
  }
};
