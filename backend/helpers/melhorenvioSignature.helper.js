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
    const signature = req.headers["x-me-signature"];

    // Alguns provedores validam URL de webhook com ping sem assinatura.
    // Nesse caso retornamos 200, mas não processamos evento.
    if (!signature) {
      return res.status(200).json({
        success: true,
        message: "Webhook endpoint disponível",
        skipped: true,
      });
    }

    const isValid = verifyMelhorEnvioSignature(req);

    if (!isValid) {
      return res.status(200).json({
        success: false,
        skipped: true,
        message: "Webhook recebido, mas assinatura inválida. Evento não processado.",
        errorCode: "ME_SIGNATURE_INVALID",
      });
    }

    next();
  } catch (error) {
    const status = error.errorCode === "ME_SECRET_NOT_CONFIGURED" ? 200 : 200;
    return res.status(status).json({
      success: false,
      skipped: true,
      errorCode: error.errorCode || "WEBHOOK_AUTH_ERROR",
      message: error.message || "Webhook recebido, mas não processado.",
    });
  }
};
