import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

export const orderIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "paid", "failed", "cancelled"]).optional(),
});
