import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

export const notificationIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const notificationListQuerySchema = paginationQuerySchema.extend({
  isRead: z.enum(["true", "false"]).optional(),
  type: z
    .enum([
      "order_status",
      "product_sold",
      "review_received",
      "seller_reply",
      "order_cancelled",
      "refund",
      "store_visits",
      "coupon_new",
      "coupon_expiring",
      "product_discount",
      "promotion",
      "cart_reminder",
      "admin_announcement",
    ])
    .optional(),
});

export const adminBroadcastNotificationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(2000),
  actionUrl: z.string().trim().url("URL inválida").optional().nullable(),
  audience: z.enum(["seller", "customer", "everyone"]),
  type: z
    .enum([
      "admin_announcement",
      "promotion",
      "coupon_new",
      "product_discount",
      "seller_reply",
      "order_status",
      "product_sold",
      "review_received",
      "order_cancelled",
      "refund",
      "store_visits",
      "coupon_expiring",
      "cart_reminder",
    ])
    .optional()
    .default("admin_announcement"),
});
