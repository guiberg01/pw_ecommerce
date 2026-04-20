import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";
import { paginationQuerySchema } from "./product.validator.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateFromQueryBoundary = (boundary) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (DATE_ONLY_PATTERN.test(trimmed)) {
      return boundary === "start"
        ? new Date(`${trimmed}T00:00:00.000Z`)
        : new Date(`${trimmed}T23:59:59.999Z`);
    }

    return trimmed;
  }, z.coerce.date().optional());

export const orderIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const orderListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(["pending", "paid", "failed", "cancelled"]).optional(),
    createdFrom: dateFromQueryBoundary("start"),
    createdTo: dateFromQueryBoundary("end"),
    sort: z.enum(["newest", "oldest"]).optional().default("newest"),
  })
  .superRefine((data, ctx) => {
    if (data.createdFrom && data.createdTo && data.createdFrom > data.createdTo) {
      ctx.addIssue({
        code: "custom",
        path: ["createdFrom"],
        message: "createdFrom não pode ser maior que createdTo",
      });
    }
  });
