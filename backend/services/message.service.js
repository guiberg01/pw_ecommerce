import crypto from "crypto";
import Ticket from "../models/ticket.model.js";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { redis } from "../config/redis.js";
import { createNotificationForUser } from "./notification.service.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS = 5;
const SPAM_WINDOW_SECONDS = 60;
const SPAM_MAX_PER_WINDOW = Number(process.env.MESSAGE_SPAM_MAX_PER_MINUTE ?? 20);
const DUPLICATE_WINDOW_SECONDS = 20;

const INAPPROPRIATE_PATTERNS = [
  /\b(caralho|porra|puta|puto|pqp|cacete|cuzao|arrombado)\b/i,
  /\b(foda-se|fodas+e|fdp)\b/i,
  /\b(otario|idiota|imbecil|babaca|retardado)\b/i,
  /\b(viadinho|biscate|vagabunda|vadia)\b/i,
];

const normalizePagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limit)))
    : DEFAULT_LIMIT;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
};

const buildPaginationResult = ({ items, total, page, limit }) => ({
  items,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / Math.max(limit, 1)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  },
});

const normalizeText = (value) => String(value ?? "").trim();

const normalizeAttachments = (attachments = []) => {
  if (!Array.isArray(attachments)) return [];
  const unique = [...new Set(attachments.map((item) => String(item ?? "").trim()).filter(Boolean))];
  return unique.slice(0, MAX_ATTACHMENTS);
};

const assertMessagePayloadOrThrow = ({ text, attachments }) => {
  const normalizedText = normalizeText(text);
  const normalizedAttachments = normalizeAttachments(attachments);

  if (!normalizedText && normalizedAttachments.length === 0) {
    throw createHttpError(
      "Envie texto ou ao menos um anexo",
      400,
      undefined,
      "MESSAGE_EMPTY_PAYLOAD",
    );
  }

  return {
    text: normalizedText,
    attachments: normalizedAttachments,
  };
};

const assertNoInappropriateContentOrThrow = (text) => {
  if (!text) return;

  const blocked = INAPPROPRIATE_PATTERNS.find((pattern) => pattern.test(text));
  if (blocked) {
    throw createHttpError(
      "Mensagem contém conteúdo inadequado",
      400,
      undefined,
      "MESSAGE_CONTENT_NOT_ALLOWED",
    );
  }
};

const ensureStoreExistsOrThrow = async (storeId) => {
  const store = await Store.findOne({ _id: storeId, status: { $ne: "deleted" } }).select("_id owner name").lean();

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "MESSAGE_STORE_NOT_FOUND");
  }

  return store;
};

const ensureConversationAccessOrThrow = async (conversation, actor) => {
  if (actor.role === "admin") {
    return {
      scope: "admin",
      recipientId: null,
    };
  }

  if (actor.role === "customer") {
    if (conversation.user.toString() !== actor._id.toString()) {
      throw createHttpError("Acesso proibido", 403, undefined, "MESSAGE_CONVERSATION_FORBIDDEN");
    }

    const store = await ensureStoreExistsOrThrow(conversation.store);
    return {
      scope: "customer",
      recipientId: store.owner,
      store,
    };
  }

  if (actor.role === "seller") {
    const store = await ensureStoreExistsOrThrow(conversation.store);

    if (String(store.owner) !== actor._id.toString()) {
      throw createHttpError("Acesso proibido", 403, undefined, "MESSAGE_CONVERSATION_FORBIDDEN");
    }

    return {
      scope: "seller",
      recipientId: conversation.user,
      store,
    };
  }

  throw createHttpError("Acesso proibido", 403, undefined, "MESSAGE_CONVERSATION_FORBIDDEN");
};

const ensureConversationNotBlockedOrThrow = (conversation, actor) => {
  if (actor.role === "admin") return;

  if (conversation.isBlocked) {
    throw createHttpError(
      "Esta conversa está bloqueada para novas mensagens",
      403,
      {
        blockedAt: conversation.blockedAt,
        blockedBy: conversation.blockedBy,
      },
      "MESSAGE_CONVERSATION_BLOCKED",
    );
  }
};

const getSenderRole = (actor) => {
  if (actor.role === "seller") return "seller";
  if (actor.role === "admin") return "admin";
  return "customer";
};

const makeSpamRateKey = ({ senderId, scope }) => `message:spam:${scope}:${String(senderId)}`;
const makeDuplicateKey = ({ senderId, scope, hash }) => `message:dup:${scope}:${String(senderId)}:${hash}`;

const ensureAntiSpamOrThrow = async ({ senderId, scope, text, attachments }) => {
  const rateKey = makeSpamRateKey({ senderId, scope });
  const current = await redis.incr(rateKey);

  if (current === 1) {
    await redis.expire(rateKey, SPAM_WINDOW_SECONDS);
  }

  if (current > SPAM_MAX_PER_WINDOW) {
    throw createHttpError(
      "Muitas mensagens em pouco tempo. Tente novamente em instantes.",
      429,
      { windowSeconds: SPAM_WINDOW_SECONDS, max: SPAM_MAX_PER_WINDOW },
      "MESSAGE_RATE_LIMITED",
    );
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(`${String(text)}::${JSON.stringify(attachments)}`)
    .digest("hex");

  const duplicateKey = makeDuplicateKey({ senderId, scope, hash: contentHash });
  const duplicated = await redis.set(duplicateKey, "1", "NX", "EX", DUPLICATE_WINDOW_SECONDS);

  if (duplicated !== "OK") {
    throw createHttpError(
      "Mensagem duplicada enviada em sequência",
      429,
      { duplicateWindowSeconds: DUPLICATE_WINDOW_SECONDS },
      "MESSAGE_DUPLICATE_RATE_LIMITED",
    );
  }
};

const summarizeMessage = (text, attachments) => {
  if (text) return text.slice(0, 100);
  if (attachments.length) return "Arquivo enviado";
  return "Mensagem";
};

const buildConversationSummary = (conversation) => {
  const last = conversation.messages?.[conversation.messages.length - 1] ?? null;

  return {
    _id: conversation._id,
    user: conversation.user,
    store: conversation.store,
    subject: conversation.subject,
    status: conversation.status,
    isBlocked: conversation.isBlocked,
    blockedBy: conversation.blockedBy,
    blockedRole: conversation.blockedRole,
    blockedAt: conversation.blockedAt,
    unreadCountCustomer: conversation.unreadCountCustomer ?? 0,
    unreadCountSeller: conversation.unreadCountSeller ?? 0,
    lastMessageAt: conversation.lastMessageAt ?? last?.createdAt ?? conversation.updatedAt,
    lastMessage: last
      ? {
          _id: last._id,
          sender: last.sender,
          senderRole: last.senderRole,
          text: last.text,
          attachments: last.attachments ?? [],
          createdAt: last.createdAt,
          isRead: last.isRead,
          readAt: last.readAt,
        }
      : null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

const buildConversationMessages = (conversation) => {
  return (conversation.messages ?? []).map((message) => ({
    _id: message._id,
    sender: message.sender,
    senderRole: message.senderRole,
    text: message.text,
    attachments: message.attachments ?? [],
    createdAt: message.createdAt,
    isRead: message.isRead,
    readAt: message.readAt,
  }));
};

const markConversationReadForRole = async (conversation, actor) => {
  const senderRole = getSenderRole(actor);
  const now = new Date();
  let changed = false;

  for (const message of conversation.messages ?? []) {
    if (message.senderRole !== senderRole && !message.isRead) {
      message.isRead = true;
      message.readAt = now;
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  if (senderRole === "customer") {
    conversation.unreadCountCustomer = 0;
  } else if (senderRole === "seller") {
    conversation.unreadCountSeller = 0;
  }

  await conversation.save();
  return true;
};

const notifyIncomingMessage = async ({ conversation, senderRole, senderName, recipientId }) => {
  if (!recipientId) return;

  const roleLabel = senderRole === "seller" ? "loja" : senderRole === "customer" ? "cliente" : "admin";
  const title = senderRole === "seller" ? "Nova mensagem da loja" : "Nova mensagem de cliente";
  const message = `${senderName} (${roleLabel}) enviou uma mensagem para você.`;

  await createNotificationForUser(recipientId, {
    title,
    message,
    type: "chat_message",
    recipientRole: senderRole === "seller" ? "customer" : "seller",
    actionUrl: `/messages/conversations/${conversation._id}`,
    refModel: { refId: conversation._id, refModel: "Store" },
  });
};

const applyUnreadCounterOnSend = (conversation, senderRole) => {
  if (senderRole === "customer") {
    conversation.unreadCountSeller = Number(conversation.unreadCountSeller ?? 0) + 1;
  } else if (senderRole === "seller") {
    conversation.unreadCountCustomer = Number(conversation.unreadCountCustomer ?? 0) + 1;
  }
};

export const listConversationsForActor = async (actor, query = {}) => {
  const { page, limit, skip } = normalizePagination(query);

  let filters = {};

  if (actor.role === "customer") {
    filters = { user: actor._id };
  } else if (actor.role === "seller") {
    const ownedStoreIds = await Store.find({ owner: actor._id, status: { $ne: "deleted" } }).distinct("_id");
    filters = { store: { $in: ownedStoreIds } };
  }

  const [items, total] = await Promise.all([
    Ticket.find(filters)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name email")
      .populate("store", "name owner"),
    Ticket.countDocuments(filters),
  ]);

  return buildPaginationResult({
    items: items.map((item) => buildConversationSummary(item.toObject())),
    total,
    page,
    limit,
  });
};

export const listAllConversationsForAdmin = async (query = {}) => {
  const { page, limit, skip } = normalizePagination(query);

  const [items, total] = await Promise.all([
    Ticket.find({})
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "name email")
      .populate("store", "name owner"),
    Ticket.countDocuments({}),
  ]);

  return buildPaginationResult({
    items: items.map((item) => buildConversationSummary(item.toObject())),
    total,
    page,
    limit,
  });
};

export const getConversationMessagesForActor = async (actor, conversationId) => {
  const conversation = await Ticket.findById(conversationId)
    .populate("user", "name email")
    .populate("store", "name owner");

  if (!conversation) {
    throw createHttpError("Conversa não encontrada", 404, undefined, "MESSAGE_CONVERSATION_NOT_FOUND");
  }

  await ensureConversationAccessOrThrow(conversation, actor);
  await markConversationReadForRole(conversation, actor);

  return {
    conversation: buildConversationSummary(conversation.toObject()),
    messages: buildConversationMessages(conversation.toObject()),
  };
};

export const startConversationForStore = async (actor, storeId, payload) => {
  const { text, attachments } = assertMessagePayloadOrThrow(payload);
  assertNoInappropriateContentOrThrow(text);

  const store = await ensureStoreExistsOrThrow(storeId);

  if (actor.role !== "customer" && actor.role !== "admin") {
    throw createHttpError("Acesso proibido", 403, undefined, "MESSAGE_CONVERSATION_CREATE_FORBIDDEN");
  }

  await ensureAntiSpamOrThrow({
    senderId: actor._id,
    scope: `store:${storeId}`,
    text,
    attachments,
  });

  const senderRole = getSenderRole(actor);

  let conversation = await Ticket.findOne({ user: actor._id, store: store._id });

  if (!conversation) {
    conversation = new Ticket({
      user: actor._id,
      store: store._id,
      subject: payload.subject ? String(payload.subject).trim() : `Conversa com ${store.name}`,
      status: "open",
      priority: "medium",
      messages: [],
      isBlocked: false,
      blockedBy: null,
      blockedRole: null,
      blockedAt: null,
      unreadCountCustomer: 0,
      unreadCountSeller: 0,
    });
  }

  ensureConversationNotBlockedOrThrow(conversation, actor);

  conversation.messages.push({
    senderRole,
    sender: actor._id,
    text,
    attachments,
    isRead: false,
    readAt: null,
  });
  conversation.status = "in_progress";
  conversation.lastMessageAt = new Date();
  applyUnreadCounterOnSend(conversation, senderRole);

  await conversation.save();

  await notifyIncomingMessage({
    conversation,
    senderRole,
    senderName: actor.name ?? "Usuário",
    recipientId: store.owner,
  });

  return {
    conversation: buildConversationSummary(conversation.toObject()),
    message: buildConversationMessages(conversation.toObject()).at(-1),
  };
};

export const sendMessageToConversation = async (actor, conversationId, payload) => {
  const { text, attachments } = assertMessagePayloadOrThrow(payload);
  assertNoInappropriateContentOrThrow(text);

  const conversation = await Ticket.findById(conversationId).populate("store", "owner name");

  if (!conversation) {
    throw createHttpError("Conversa não encontrada", 404, undefined, "MESSAGE_CONVERSATION_NOT_FOUND");
  }

  const access = await ensureConversationAccessOrThrow(conversation, actor);
  ensureConversationNotBlockedOrThrow(conversation, actor);

  await ensureAntiSpamOrThrow({
    senderId: actor._id,
    scope: `conversation:${conversation._id}`,
    text,
    attachments,
  });

  const senderRole = getSenderRole(actor);

  conversation.messages.push({
    senderRole,
    sender: actor._id,
    text,
    attachments,
    isRead: false,
    readAt: null,
  });

  conversation.status = "in_progress";
  conversation.lastMessageAt = new Date();
  applyUnreadCounterOnSend(conversation, senderRole);

  await conversation.save();

  const recipientId = access.recipientId ?? (senderRole === "customer" ? conversation.store?.owner : conversation.user);

  await notifyIncomingMessage({
    conversation,
    senderRole,
    senderName: actor.name ?? "Usuário",
    recipientId,
  });

  return {
    conversation: buildConversationSummary(conversation.toObject()),
    message: buildConversationMessages(conversation.toObject()).at(-1),
  };
};

export const markConversationAsReadForActor = async (actor, conversationId) => {
  const conversation = await Ticket.findById(conversationId);

  if (!conversation) {
    throw createHttpError("Conversa não encontrada", 404, undefined, "MESSAGE_CONVERSATION_NOT_FOUND");
  }

  await ensureConversationAccessOrThrow(conversation, actor);
  await markConversationReadForRole(conversation, actor);

  return buildConversationSummary(conversation.toObject());
};

export const blockConversationForActor = async (actor, conversationId) => {
  const conversation = await Ticket.findById(conversationId);

  if (!conversation) {
    throw createHttpError("Conversa não encontrada", 404, undefined, "MESSAGE_CONVERSATION_NOT_FOUND");
  }

  await ensureConversationAccessOrThrow(conversation, actor);

  conversation.isBlocked = true;
  conversation.blockedBy = actor._id;
  conversation.blockedRole = getSenderRole(actor);
  conversation.blockedAt = new Date();
  conversation.status = "closed";

  await conversation.save();

  return buildConversationSummary(conversation.toObject());
};

export const unblockConversationForActor = async (actor, conversationId) => {
  const conversation = await Ticket.findById(conversationId);

  if (!conversation) {
    throw createHttpError("Conversa não encontrada", 404, undefined, "MESSAGE_CONVERSATION_NOT_FOUND");
  }

  await ensureConversationAccessOrThrow(conversation, actor);

  if (
    actor.role !== "admin"
    && conversation.blockedBy
    && conversation.blockedBy.toString() !== actor._id.toString()
  ) {
    throw createHttpError(
      "Apenas quem bloqueou pode desbloquear a conversa",
      403,
      undefined,
      "MESSAGE_UNBLOCK_FORBIDDEN",
    );
  }

  conversation.isBlocked = false;
  conversation.blockedBy = null;
  conversation.blockedRole = null;
  conversation.blockedAt = null;
  if (conversation.status === "closed") {
    conversation.status = "in_progress";
  }

  await conversation.save();

  return buildConversationSummary(conversation.toObject());
};
