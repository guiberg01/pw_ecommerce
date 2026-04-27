import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

const checkoutCouponCodeSchema = z
  .string()
  .trim()
  .min(1, "Código do cupom inválido")
  .max(50, "Código do cupom inválido")
  .transform((value) => value.toUpperCase())
  .optional();

const checkoutShippingSelectionSchema = z.object({
  storeId: mongoIdSchema,
  carrierId: z.union([z.string().trim().min(1), z.number()]),
});

export const checkoutShippingOptionsSchema = z.object({
  addressId: mongoIdSchema,
  couponCode: checkoutCouponCodeSchema,
});

export const createCheckoutIntentSchema = z.object({
  addressId: mongoIdSchema,
  paymentMethodId: mongoIdSchema,
  couponCode: checkoutCouponCodeSchema,
  shippingSelections: z.array(checkoutShippingSelectionSchema).min(1, "Seleção de frete é obrigatória"),
});

export const checkoutOrderIdParamSchema = z.object({
  orderId: mongoIdSchema,
});
