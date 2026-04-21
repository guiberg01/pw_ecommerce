import { body, param, query, validationResult } from "express-validator";

/**
 * Validadores para endpoints de shipping
 */

// Validador para calcular frete
export const calculateShippingSchema = [
  param("subOrderId").isMongoId().withMessage("subOrderId inválido"),
  query("forceRecalculate").optional().isBoolean().withMessage("forceRecalculate deve ser boolean"),
];

// Validador para selecionar transportadora
export const selectShippingSchema = [
  param("subOrderId").isMongoId().withMessage("subOrderId inválido"),
  body("carrierId").notEmpty().withMessage("carrierId é obrigatório"),
  body("quoteId").isMongoId().withMessage("quoteId inválido"),
];

// Validador para gerar etiqueta
export const generateLabelSchema = [param("subOrderId").isMongoId().withMessage("subOrderId inválido")];

// Validador para callback de webhook
export const webhookSchema = [
  body("event").notEmpty().withMessage("event é obrigatório"),
  body("data").notEmpty().withMessage("data é obrigatório"),
];

// Validador para OAuth callback
export const oauthCallbackSchema = [
  query("code").notEmpty().withMessage("code é obrigatório"),
  query("state").notEmpty().withMessage("state é obrigatório"),
];

/**
 * Middleware de validação
 */
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validação falhou",
      errorCode: "VALIDATION_ERROR",
      details: errors.array(),
      timestamp: new Date(),
    });
  }
  next();
};
