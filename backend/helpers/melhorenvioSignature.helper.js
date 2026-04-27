import crypto from "crypto";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";
import { createHttpError } from "./httpError.js";

const isStrictWebhookAuthEnabled = () => {
  const raw = String(process.env.MELHOR_ENVIO_WEBHOOK_STRICT ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
};

/**
 * Verifica autenticidade da requisição webhook do MelhorEnvio
 * Usa HMAC-SHA256 com o secret do aplicativo
 * 
 * Docs: https://docs.melhorenvio.com.br/docs/webhooks
 */

export const verifyMelhorEnvioSignature = (req) => {
  const signature = req.headers["x-me-signature"];

  if (!signature) {
    throw createHttpError("X-ME-Signature header não encontrado", 400, undefined, "ME_SIGNATURE_MISSING");
  }

  if (!MELHOR_ENVIO_CONFIG.webhook.secret) {
    throw createHttpError(
      "MELHOR_ENVIO_WEBHOOK_SECRET não configurado",
      500,
      undefined,
      "ME_SECRET_NOT_CONFIGURED",
    );
  }

  const body = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac("sha256", MELHOR_ENVIO_CONFIG.webhook.secret)
    .update(body)
    .digest("base64");

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );

  return isValid;
};

/**
 * Middleware para autenticar webhooks
 */
export const webhookAuthMiddleware = (req, res, next) => {
  try {
    const strictMode = isStrictWebhookAuthEnabled();
    const signature = req.headers["x-me-signature"];

    // Alguns provedores validam URL de webhook com ping sem assinatura.
    // Nesse caso retornamos 200, mas não processamos evento.
    if (!signature) {
      if (strictMode) {
        return res.status(401).json({
          success: false,
          skipped: false,
          message: "Assinatura ausente no webhook.",
          errorCode: "ME_SIGNATURE_MISSING",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Webhook endpoint disponível",
        skipped: true,
      });
    }

    const isValid = verifyMelhorEnvioSignature(req);

    if (!isValid) {
      if (strictMode) {
        return res.status(403).json({
          success: false,
          skipped: false,
          message: "Assinatura inválida no webhook.",
          errorCode: "ME_SIGNATURE_INVALID",
        });
      }

      return res.status(200).json({
        success: false,
        skipped: true,
        message: "Webhook recebido, mas assinatura inválida. Evento não processado.",
        errorCode: "ME_SIGNATURE_INVALID",
      });
    }

    next();
  } catch (error) {
    const strictMode = isStrictWebhookAuthEnabled();

    if (strictMode) {
      const statusByErrorCode = {
        ME_SIGNATURE_MISSING: 401,
        ME_SIGNATURE_INVALID: 403,
        ME_SECRET_NOT_CONFIGURED: 500,
      };

      return res.status(statusByErrorCode[error.code] || 401).json({
        success: false,
        skipped: false,
        errorCode: error.code || "WEBHOOK_AUTH_ERROR",
        message: error.message || "Webhook não autorizado.",
      });
    }

    return res.status(200).json({
      success: false,
      skipped: true,
      errorCode: error.code || "WEBHOOK_AUTH_ERROR",
      message: error.message || "Webhook recebido, mas não processado.",
    });
  }
};
