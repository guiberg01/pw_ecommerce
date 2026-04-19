import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

const productVariantSchema = z.object({
  attributes: z.record(z.string(), z.string()).optional().default({}),
  price: z.number().positive("Preço deve ser maior que zero"),
  stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero"),
  sku: z
    .string()
    .trim()
    .min(1, "SKU é obrigatório")
    .transform((value) => value.toUpperCase()),
  imageUrl: z.url("A imagem deve ser uma URL válida").trim(),
  datasheet: z.string().trim().optional().nullable(),
  weight: z.number().min(0, "Peso deve ser maior ou igual a zero").optional().nullable(),
  length: z.number().min(0, "Comprimento deve ser maior ou igual a zero").optional().nullable(),
  width: z.number().min(0, "Largura deve ser maior ou igual a zero").optional().nullable(),
  height: z.number().min(0, "Altura deve ser maior ou igual a zero").optional().nullable(),
});

const productVariantUpdateSchema = z
  .object({
    variantId: mongoIdSchema.optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    price: z.number().positive("Preço deve ser maior que zero").optional(),
    stock: z.number().int().min(0, "Estoque deve ser maior ou igual a zero").optional(),
    sku: z
      .string()
      .trim()
      .min(1, "SKU é obrigatório")
      .transform((value) => value.toUpperCase())
      .optional(),
    imageUrl: z.url("A imagem deve ser uma URL válida").trim().optional(),
    datasheet: z.string().trim().optional().nullable(),
    weight: z.number().min(0, "Peso deve ser maior ou igual a zero").optional().nullable(),
    length: z.number().min(0, "Comprimento deve ser maior ou igual a zero").optional().nullable(),
    width: z.number().min(0, "Largura deve ser maior ou igual a zero").optional().nullable(),
    height: z.number().min(0, "Altura deve ser maior ou igual a zero").optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const hasAnyField = Object.entries(data).some(([key, value]) => key !== "variantId" && value !== undefined);

    if (!data.variantId) {
      if (data.price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "Preço é obrigatório para criar uma variação extra",
        });
      }

      if (data.stock === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stock"],
          message: "Estoque é obrigatório para criar uma variação extra",
        });
      }

      if (data.sku === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sku"],
          message: "SKU é obrigatório para criar uma variação extra",
        });
      }

      if (data.imageUrl === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["imageUrl"],
          message: "Imagem é obrigatória para criar uma variação extra",
        });
      }
    }

    if (data.variantId && !hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variantId"],
        message: "Envie ao menos um campo para atualizar a variação",
      });
    }
  });

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório"),
    description: z.string().trim().min(1, "Descrição é obrigatória"),
    category: mongoIdSchema,
    highlighted: z.boolean().optional().default(false),
    maxPerPerson: z.number().int().min(1, "Limite máximo deve ser ao menos 1").optional().nullable(),
    mainVariant: productVariantSchema,
    variants: z.array(productVariantSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.maxPerPerson != null && data.maxPerPerson > data.mainVariant.stock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPerPerson"],
        message: "O limite máximo por pessoa não pode ser maior que o estoque",
      });
    }

    const skus = [data.mainVariant.sku, ...data.variants.map((variant) => variant.sku)];
    if (new Set(skus).size !== skus.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Não é permitido repetir SKU entre a variação principal e as variações extras",
      });
    }
  });

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório").optional(),
    description: z.string().trim().min(1, "Descrição é obrigatória").optional(),
    category: mongoIdSchema.optional(),
    highlighted: z.boolean().optional(),
    maxPerPerson: z.number().int().min(1, "Limite máximo deve ser ao menos 1").optional().nullable(),
    status: z.enum(["active", "blocked", "deleted"]).optional(),
    mainVariant: productVariantSchema.partial().optional(),
    variants: z.array(productVariantUpdateSchema).optional(),
    removeVariantIds: z.array(mongoIdSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.maxPerPerson != null && data.mainVariant?.stock != null && data.maxPerPerson > data.mainVariant.stock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPerPerson"],
        message: "O limite máximo por pessoa não pode ser maior que o estoque",
      });
    }

    if (data.mainVariant?.sku || (data.variants?.length ?? 0) > 0) {
      const skus = [data.mainVariant?.sku, ...(data.variants ?? []).map((variant) => variant.sku)].filter(Boolean);

      if (new Set(skus).size !== skus.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: "Não é permitido repetir SKU entre variações",
        });
      }
    }
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });

export const productIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const productVariantIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const productListQuerySchema = z.object({
  categoryId: mongoIdSchema.optional(),
});
