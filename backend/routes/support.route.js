import { Router } from "express";
import {
  getSupportTicketById,
  getSupportTickets,
  patchSupportTicketAssign,
  patchSupportTicketBlock,
  patchSupportTicketRead,
  patchSupportTicketStatus,
  patchSupportTicketUnblock,
  postSupportTicket,
  postSupportTicketMessage,
} from "../controllers/support.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { createRateLimit } from "../middleware/rateLimit.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import {
  supportAssignTicketSchema,
  supportCreateTicketSchema,
  supportListQuerySchema,
  supportSendMessageSchema,
  supportTicketIdParamSchema,
  supportUpdateStatusSchema,
} from "../validators/support.validator.js";

const router = Router();

const createSupportRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SUPPORT_CREATE_RATE_LIMIT ?? 10),
  scope: "support:create",
  message: "Muitas aberturas de ticket em pouco tempo. Aguarde alguns minutos.",
});

const supportMessageRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.SUPPORT_MESSAGE_RATE_LIMIT_PER_MINUTE ?? 15),
  scope: "support:message",
  message: "Muitas mensagens em pouco tempo. Tente novamente em instantes.",
});

router.use(isLoggedIn);

router.get("/tickets", validateQuery(supportListQuerySchema), getSupportTickets);
router.post("/tickets", createSupportRateLimit, validateBody(supportCreateTicketSchema), postSupportTicket);
router.get("/tickets/:id", validateParams(supportTicketIdParamSchema), getSupportTicketById);
router.post(
  "/tickets/:id/messages",
  supportMessageRateLimit,
  validateParams(supportTicketIdParamSchema),
  validateBody(supportSendMessageSchema),
  postSupportTicketMessage,
);
router.patch("/tickets/:id/read", validateParams(supportTicketIdParamSchema), patchSupportTicketRead);
router.patch("/tickets/:id/block", validateParams(supportTicketIdParamSchema), patchSupportTicketBlock);
router.patch("/tickets/:id/unblock", validateParams(supportTicketIdParamSchema), patchSupportTicketUnblock);

router.patch(
  "/tickets/:id/assign",
  isAdmin,
  validateParams(supportTicketIdParamSchema),
  validateBody(supportAssignTicketSchema),
  patchSupportTicketAssign,
);
router.patch(
  "/tickets/:id/status",
  validateParams(supportTicketIdParamSchema),
  validateBody(supportUpdateStatusSchema),
  patchSupportTicketStatus,
);

export default router;
