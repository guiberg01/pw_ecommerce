import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

export const orderIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const orderListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(["pending", "paid", "failed", "cancelled"]).optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    sort: z.enum(["newest", "oldest"]).optional().default("newest"),
  })
  .superRefine((data, ctx) => {
    if (data.createdFrom && data.createdTo && data.createdFrom > data.createdTo) {
      ctx.addIssue({
        code: "custom",
        path: ["createdFrom"],
        message: "createdFrom não pode ser maior que createdTo",
      });
    }
  });
