import { Router } from "express";
import {
  getAdminConversationMessages,
  getAdminConversations,
  getMyConversationMessages,
  getMyConversations,
  patchBlockConversation,
  patchReadConversation,
  patchUnblockConversation,
  postSendMessageInConversation,
  postStartConversationWithStore,
} from "../controllers/message.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import {
  messageConversationIdParamSchema,
  messageListConversationQuerySchema,
  messageStoreParamSchema,
  sendMessageSchema,
  startConversationSchema,
} from "../validators/message.validator.js";
import { createRateLimit } from "../middleware/rateLimit.middleware.js";

const router = Router();

const sendMessageRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.MESSAGE_SEND_RATE_LIMIT_PER_MINUTE ?? 20),
  scope: "messages:send",
  message: "Muitas mensagens em pouco tempo. Tente novamente em instantes.",
});

router.use(isLoggedIn);

router.get("/conversations", validateQuery(messageListConversationQuerySchema), getMyConversations);
router.get("/conversations/:id/messages", validateParams(messageConversationIdParamSchema), getMyConversationMessages);
router.patch("/conversations/:id/read", validateParams(messageConversationIdParamSchema), patchReadConversation);
router.patch("/conversations/:id/block", validateParams(messageConversationIdParamSchema), patchBlockConversation);
router.patch("/conversations/:id/unblock", validateParams(messageConversationIdParamSchema), patchUnblockConversation);
router.post(
  "/stores/:storeId/messages",
  sendMessageRateLimit,
  validateParams(messageStoreParamSchema),
  validateBody(startConversationSchema),
  postStartConversationWithStore,
);
router.post(
  "/conversations/:id/messages",
  sendMessageRateLimit,
  validateParams(messageConversationIdParamSchema),
  validateBody(sendMessageSchema),
  postSendMessageInConversation,
);

router.get("/admin/conversations", isAdmin, validateQuery(messageListConversationQuerySchema), getAdminConversations);
router.get(
  "/admin/conversations/:id/messages",
  isAdmin,
  validateParams(messageConversationIdParamSchema),
  getAdminConversationMessages,
);

export default router;
