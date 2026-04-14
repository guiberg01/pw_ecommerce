import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

//zod pra validações

//criar
export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório"),
    description: z.string().trim().min(1, "Descrição é obrigatória"),
    price: z.number().positive("Preço deve ser maior que zero"),
    imageUrl: z.string().trim().url("A imagem deve ser uma URL válida"),
    category: z.string().trim().min(1, "Categoria é obrigatória"),
    highlighted: z.boolean().optional().default(false),
    stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero"),
    maxPerPerson: z.number().int().min(1, "Limite máximo deve ser ao menos 1").optional().nullable(),
  })
  .refine((data) => data.maxPerPerson == null || data.maxPerPerson <= data.stock, {
    message: "O limite máximo por pessoa não pode ser maior que o estoque",
    path: ["maxPerPerson"],
  });

//update
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório").optional(),
    description: z.string().trim().min(1, "Descrição é obrigatória").optional(),
    price: z.number().positive("Preço deve ser maior que zero").optional(),
    imageUrl: z.string().trim().url("A imagem deve ser uma URL válida").optional(),
    category: z.string().trim().min(1, "Categoria é obrigatória").optional(),
    highlighted: z.boolean().optional(),
    stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero").optional(),
    maxPerPerson: z.number().int().min(1, "Limite máximo deve ser ao menos 1").optional().nullable(),
    status: z.enum(["available", "blocked", "unavailable", "cancelled"]).optional(),
  })
  .refine((data) => data.maxPerPerson == null || data.stock == null || data.maxPerPerson <= data.stock, {
    message: "O limite máximo por pessoa não pode ser maior que o estoque",
    path: ["maxPerPerson"],
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });

export const productIdParamSchema = z.object({
  id: mongoIdSchema,
});
