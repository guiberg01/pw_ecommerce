import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

export const categoryIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nome da categoria é obrigatório"),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "Nome da categoria é obrigatório").optional(),
    status: z.enum(["active", "inactive", "deleted"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });
