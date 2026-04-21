import crypto from "crypto";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";

/**
 * Verifica autenticidade da requisição webhook do MelhorEnvio
 * Usa HMAC-SHA256 com o secret do aplicativo
 * 
 * Docs: https://docs.melhorenvio.com.br/docs/webhooks
 */

export const verifyMelhorEnvioSignature = (req) => {
  const signature = req.headers["x-me-signature"];

  if (!signature) {
    throw {
      errorCode: "ME_SIGNATURE_MISSING",
      message: "X-ME-Signature header não encontrado",
    };
  }

  if (!MELHOR_ENVIO_CONFIG.webhook.secret) {
    throw {
      errorCode: "ME_SECRET_NOT_CONFIGURED",
      message: "MELHOR_ENVIO_WEBHOOK_SECRET não configurado",
    };
  }

  const body = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac("sha256", MELHOR_ENVIO_CONFIG.webhook.secret)
    .update(body)
    .digest("base64");

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
    const isValid = verifyMelhorEnvioSignature(req);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        errorCode: "ME_SIGNATURE_INVALID",
        message: "Assinatura do webhook inválida",
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      errorCode: error.errorCode || "WEBHOOK_AUTH_ERROR",
      message: error.message,
    });
  }
};
