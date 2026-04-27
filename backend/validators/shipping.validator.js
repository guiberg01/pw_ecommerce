import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

/**
 * Validadores para endpoints de shipping
 */

export const shippingSubOrderParamSchema = z.object({
  subOrderId: mongoIdSchema,
});

export const shippingOptionsQuerySchema = z.object({
  forceRecalculate: z.enum(["true", "false"]).optional(),
});

export const selectShippingBodySchema = z.object({
  carrierId: z.union([z.string().trim().min(1), z.number()]),
  quoteId: mongoIdSchema,
});

export const shippingWebhookBodySchema = z.object({
  event: z.string().trim().min(1),
  data: z.any(),
});

export const shippingOAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
});
