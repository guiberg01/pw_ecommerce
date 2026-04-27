import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

const supportCategorySchema = z.enum([
  "technical",
  "order",
  "store",
  "refund",
  "delivery",
  "payment",
  "account",
  "other",
]);

const supportPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const supportStatusSchema = z.enum([
  "open",
  "triage",
  "in_progress",
  "waiting_requester",
  "waiting_internal",
  "resolved",
  "reopened",
  "closed",
]);

const supportAttachmentsSchema = z
  .array(
    z
      .string()
      .trim()
      .pipe(z.url({ error: "URL de anexo inválida" })),
  )
  .max(5)
  .optional()
  .default([]);

export const supportTicketIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const supportListQuerySchema = paginationQuerySchema.extend({
  category: supportCategorySchema.optional(),
  status: supportStatusSchema.optional(),
});

export const supportCreateTicketSchema = z
  .object({
    subject: z.string().trim().min(3).max(120),
    category: supportCategorySchema,
    priority: supportPrioritySchema.optional(),
    orderId: mongoIdSchema.optional(),
    storeId: mongoIdSchema.optional(),
    text: z.string().trim().max(2000).optional(),
    attachments: supportAttachmentsSchema,
  })
  .superRefine((payload, ctx) => {
    const text = payload.text?.trim() ?? "";
    if (!text && (payload.attachments?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Envie texto ou ao menos um anexo",
      });
    }
  });

export const supportSendMessageSchema = z
  .object({
    text: z.string().trim().max(2000).optional(),
    attachments: supportAttachmentsSchema,
  })
  .superRefine((payload, ctx) => {
    const text = payload.text?.trim() ?? "";
    if (!text && (payload.attachments?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Envie texto ou ao menos um anexo",
      });
    }
  });

export const supportAssignTicketSchema = z.object({
  assigneeId: mongoIdSchema.optional(),
});

export const supportUpdateStatusSchema = z.object({
  status: supportStatusSchema,
  resolutionSummary: z.string().trim().max(2000).optional(),
});
