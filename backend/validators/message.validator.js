import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

const messageAttachmentSchema = z.array(z.string().trim().url("URL de anexo inválida")).max(5).optional().default([]);

export const messageConversationIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const messageStoreParamSchema = z.object({
  storeId: mongoIdSchema,
});

export const messageListConversationQuerySchema = paginationQuerySchema;

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(2000).optional(),
    attachments: messageAttachmentSchema,
  })
  .superRefine((payload, ctx) => {
    const text = payload.text?.trim() ?? "";
    const attachments = payload.attachments ?? [];

    if (!text && attachments.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Envie texto ou ao menos um anexo",
      });
    }
  });

export const startConversationSchema = sendMessageSchema.extend({
  subject: z.string().trim().min(1).max(120).optional(),
});
