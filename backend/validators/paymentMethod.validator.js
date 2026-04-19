import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

const paymentMethodBaseSchema = {
  stripePaymentMethodId: z.string().trim().min(1, "Identificador do método de pagamento é obrigatório"),
  type: z.string().trim().min(1, "Tipo do método de pagamento é obrigatório"),
  cardBrand: z.string().trim().optional().nullable(),
  last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/u, "Últimos 4 dígitos inválidos")
    .optional()
    .nullable(),
  expMonth: z.number().int().min(1).max(12).optional().nullable(),
  expYear: z.number().int().min(2000).optional().nullable(),
  isDefault: z.boolean().optional(),
};

export const paymentMethodIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const createPaymentMethodSchema = z.object(paymentMethodBaseSchema);

export const updatePaymentMethodSchema = z
  .object({
    stripePaymentMethodId: paymentMethodBaseSchema.stripePaymentMethodId.optional(),
    type: paymentMethodBaseSchema.type.optional(),
    cardBrand: paymentMethodBaseSchema.cardBrand,
    last4: paymentMethodBaseSchema.last4,
    expMonth: paymentMethodBaseSchema.expMonth,
    expYear: paymentMethodBaseSchema.expYear,
    isDefault: paymentMethodBaseSchema.isDefault,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });
