import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  description: z.string().trim().min(1, "Descrição é obrigatória"),
  price: z.number().positive("Preço deve ser maior que zero"),
  imageUrl: z.string().trim().url("A imagem deve ser uma URL válida"),
  category: z.string().trim().min(1, "Categoria é obrigatória"),
  highlighted: z.boolean().optional().default(false),
  stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero"),
  storeId: z.string().trim().min(1).optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório").optional(),
    description: z.string().trim().min(1, "Descrição é obrigatória").optional(),
    price: z.number().positive("Preço deve ser maior que zero").optional(),
    imageUrl: z.string().trim().url("A imagem deve ser uma URL válida").optional(),
    category: z.string().trim().min(1, "Categoria é obrigatória").optional(),
    highlighted: z.boolean().optional(),
    stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero").optional(),
    status: z.enum(["available", "blocked", "removed"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });
