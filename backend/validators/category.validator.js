import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

export const categoryIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nome da categoria é obrigatório"),
});

const positiveIntFromQuery = (defaultValue) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") return defaultValue;
      if (typeof value === "string") return Number.parseInt(value, 10);
      return value;
    },
    z.number().int().min(1),
  );

export const categoryAdminListQuerySchema = z.object({
  status: z.enum(["active", "inactive", "deleted"]).optional(),
  search: z.string().trim().min(1).optional(),
  page: positiveIntFromQuery(1),
  limit: positiveIntFromQuery(20).refine((value) => value <= 100, {
    message: "O limite máximo por página é 100",
  }),
});

export const categoryListQuerySchema = paginationQuerySchema;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "Nome da categoria é obrigatório").optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });
