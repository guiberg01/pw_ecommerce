import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

export const createCheckoutIntentSchema = z.object({
  addressId: mongoIdSchema,
  paymentMethodId: mongoIdSchema,
  couponCode: z
    .string()
    .trim()
    .min(1, "Código do cupom inválido")
    .max(50, "Código do cupom inválido")
    .transform((value) => value.toUpperCase())
    .optional(),
});
