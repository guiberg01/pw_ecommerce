import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

export const createStoreSchema = z.object({
  name: z.string().trim().min(1, "Nome da loja é obrigatório"),
  description: z.string().trim().optional().default(""),
  logoUrl: z.string().trim().url("A logo deve ser uma URL válida").optional().default(""),
});

export const updateMyStoreSchema = z
  .object({
    name: z.string().trim().min(1, "Nome da loja é obrigatório").optional(),
    description: z.string().trim().optional(),
    logoUrl: z.string().trim().url("A logo deve ser uma URL válida").optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });

export const updateStoreStatusByAdminSchema = z.object({
  status: z.enum(["active", "suspended", "blocked", "deleted", "pending"]),
});

export const storeIdParamSchema = z.object({
  storeId: mongoIdSchema,
});

export const storeListQuerySchema = z.object({
  categoryId: mongoIdSchema.optional(),
});
