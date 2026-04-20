import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

export const couponIdParamsSchema = z.object({
  id: mongoIdSchema,
});

export const couponListQuerySchema = paginationQuerySchema;

export const createCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "Código de cupom é obrigatório")
      .transform((value) => value.toUpperCase()),
    discountType: z.enum(["percentage", "fixed"], {
      error: "Tipo de desconto deve ser porcentagem ou fixo",
    }),
    discountValue: z.number().positive("Valor do desconto deve ser maior que zero"),
    minOrderValue: z.number().min(0, "Valor mínimo do pedido deve ser zero ou positivo").optional(),
    maxUses: z.number().int().positive("Número máximo de usos deve ser um inteiro positivo").optional(),
    maxUsesPerUser: z
      .number()
      .int()
      .positive("Número máximo de usos por usuário deve ser um inteiro positivo")
      .optional(),
    expiresAt: z.coerce
      .date()
      .refine((date) => date > new Date(), {
        message: "Data de expiração deve ser no futuro",
      })
      .optional(),
    products: z.array(mongoIdSchema).optional(),
    stores: z.array(mongoIdSchema).optional(),
    categories: z.array(mongoIdSchema).optional(),
    status: z.enum(["active", "inactive", "expired", "sold-out", "deleted"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === "percentage" && data.discountValue > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["discountValue"],
        message: "Desconto percentual não pode ultrapassar 100%",
      });
    }

    if (
      typeof data.maxUses === "number" &&
      typeof data.maxUsesPerUser === "number" &&
      data.maxUsesPerUser > data.maxUses
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maxUsesPerUser"],
        message: "Uso máximo por usuário não pode ser maior que o uso máximo total",
      });
    }
  });
