import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

const reviewMediaSchema = z
  .array(
    z
      .string()
      .trim()
      .pipe(z.url({ error: "URL inválida" })),
  )
  .max(10)
  .optional()
  .default([]);

export const reviewIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const productReviewParamSchema = z.object({
  productId: mongoIdSchema,
});

export const productReviewListQuerySchema = paginationQuerySchema.extend({
  sort: z.enum(["newest", "oldest", "highest", "lowest"]).optional().default("newest"),
});

export const createReviewSchema = z.object({
  productId: mongoIdSchema,
  subOrderId: mongoIdSchema,
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().default(""),
  images: reviewMediaSchema,
  videos: reviewMediaSchema,
});

export const updateReviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(2000).optional(),
    images: z
      .array(
        z
          .string()
          .trim()
          .pipe(z.url({ error: "URL inválida" })),
      )
      .max(10)
      .optional(),
    videos: z
      .array(
        z
          .string()
          .trim()
          .pipe(z.url({ error: "URL inválida" })),
      )
      .max(10)
      .optional(),
  })
  .refine(
    (payload) =>
      payload.rating !== undefined ||
      payload.comment !== undefined ||
      payload.images !== undefined ||
      payload.videos !== undefined,
    { message: "Envie ao menos um campo para atualizar" },
  );

export const upsertSellerReplySchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});
