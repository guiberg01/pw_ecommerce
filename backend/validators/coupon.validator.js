import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

export const couponIdParamsSchema = z.object({
  id: mongoIdSchema,
});
