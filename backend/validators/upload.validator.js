import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

export const uploadContextParamSchema = z.object({
  context: z.enum(["product", "store-logo", "review", "profile", "banner"]),
});

export const uploadImageBodySchema = z.object({
  subOrderId: mongoIdSchema.optional(),
});
