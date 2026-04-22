import crypto from "crypto";
import Ticket from "../models/ticket.model.js";
import User from "../models/user.model.js";
import Store from "../models/store.model.js";
import Order from "../models/order.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { redis } from "../config/redis.js";
import { createNotificationForUser, createNotificationsForUsers } from "./notification.service.js";

const SUPPORT_CHANNEL = "platform_support";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ATTACHMENTS = 5;
const SPAM_WINDOW_SECONDS = 60;
const SPAM_MAX_PER_WINDOW = Number(process.env.SUPPORT_SPAM_MAX_PER_MINUTE ?? 15);
const DUPLICATE_WINDOW_SECONDS = 20;
const SUPPORT_ADMIN_STATUSES = new Set([
  "open",
  "triage",
  "in_progress",
  "waiting_requester",
  "waiting_internal",
  "resolved",
  "reopened",
  "closed",
]);

const SUPPORT_INAPPROPRIATE_PATTERNS = [
  /\b(caralho|porra|puta|puto|pqp|cacete|cuzao|arrombado)\b/i,
  /\b(foda-se|fodas+e|fdp)\b/i,
  /\b(otario|idiota|imbecil|babaca|retardado)\b/i,
  /\b(viadinho|biscate|vagabunda|vadia)\b/i,
];

const SUPPORT_PRIORITY_BY_CATEGORY = {
  technical: "medium",
  order: "high",
  store: "medium",
  refund: "high",
  delivery: "high",
  payment: "urgent",
  account: "medium",
  other: "low",
};

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

const assertSupportMessagePayloadOrThrow = ({ text, attachments }) => {
  const normalizedText = normalizeText(text);
  const normalizedAttachments = normalizeAttachments(attachments);

  if (!normalizedText && normalizedAttachments.length === 0) {
    throw createHttpError(
      "Envie texto ou ao menos um anexo",
      400,
      undefined,
      "SUPPORT_MESSAGE_EMPTY_PAYLOAD",
    );
  }

  return {
    text: normalizedText,
    attachments: normalizedAttachments,
  };
};

const assertNoInappropriateContentOrThrow = (text) => {
  if (!text) return;

  const blocked = SUPPORT_INAPPROPRIATE_PATTERNS.find((pattern) => pattern.test(text));
  if (blocked) {
    throw createHttpError(
      "Mensagem contém conteúdo inadequado",
      400,
      undefined,
      "SUPPORT_MESSAGE_CONTENT_NOT_ALLOWED",
    );
  }
};

const getSenderRole = (actor) => {
  if (actor.role === "seller") return "seller";
  if (actor.role === "admin") return "admin";
  return "customer";
};

const buildSupportSummary = (ticket) => {
  const last = ticket.messages?.[ticket.messages.length - 1] ?? null;

  return {
    _id: ticket._id,
    channel: ticket.channel,
    ticketNumber: ticket.ticketNumber,
    requester: ticket.requester,
    requesterType: ticket.requesterType,
    assignedTo: ticket.assignedTo,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    order: ticket.order,
    store: ticket.store,
    isBlocked: ticket.isBlocked,
    blockedBy: ticket.blockedBy,
    blockedRole: ticket.blockedRole,
    blockedAt: ticket.blockedAt,
    unreadCountRequester: ticket.unreadCountRequester ?? 0,
    unreadCountPlatform: ticket.unreadCountPlatform ?? 0,
    lastMessageAt: ticket.lastMessageAt ?? last?.createdAt ?? ticket.updatedAt,
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
    resolutionSummary: ticket.resolutionSummary,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
};

const buildSupportMessages = (ticket) => {
  return (ticket.messages ?? []).map((message) => ({
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

const ensureSupportAccessOrThrow = (ticket, actor) => {
  if (actor.role === "admin") {
    return { isPlatform: true };
  }

  if (!ticket.requester || ticket.requester.toString() !== actor._id.toString()) {
    throw createHttpError("Acesso proibido", 403, undefined, "SUPPORT_TICKET_FORBIDDEN");
  }

  return { isPlatform: false };
};

const ensureSupportTicketOrThrow = async (ticketId) => {
  const ticket = await Ticket.findOne({ _id: ticketId, channel: SUPPORT_CHANNEL })
    .populate("requester", "name email role")
    .populate("assignedTo", "name email role")
    .populate("store", "name owner");

  if (!ticket) {
    throw createHttpError("Ticket de suporte não encontrado", 404, undefined, "SUPPORT_TICKET_NOT_FOUND");
  }

  return ticket;
};

const ensureTicketNotBlockedOrThrow = (ticket, actor) => {
  if (actor.role === "admin") return;

  if (ticket.isBlocked) {
    throw createHttpError(
      "Este ticket está bloqueado para novas mensagens",
      403,
      {
        blockedAt: ticket.blockedAt,
        blockedBy: ticket.blockedBy,
      },
      "SUPPORT_TICKET_BLOCKED",
    );
  }
};

const makeSpamRateKey = ({ senderId, scope }) => `support:spam:${scope}:${String(senderId)}`;
const makeDuplicateKey = ({ senderId, scope, hash }) => `support:dup:${scope}:${String(senderId)}:${hash}`;

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
      "SUPPORT_RATE_LIMITED",
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
      "SUPPORT_DUPLICATE_RATE_LIMITED",
    );
  }
};

const ensureOrderOwnershipForRequesterOrThrow = async (actor, orderId) => {
  if (!orderId) return;

  const order = await Order.findById(orderId).select("_id user").lean();
  if (!order) {
    throw createHttpError("Pedido relacionado não encontrado", 404, undefined, "SUPPORT_ORDER_NOT_FOUND");
  }

  if (actor.role === "customer" && order.user?.toString() !== actor._id.toString()) {
    throw createHttpError(
      "Pedido relacionado não pertence ao usuário",
      403,
      undefined,
      "SUPPORT_ORDER_FORBIDDEN",
    );
  }
};

const ensureStoreOwnershipForSellerOrThrow = async (actor, storeId) => {
  if (!storeId) return;

  const store = await Store.findById(storeId).select("_id owner status").lean();
  if (!store || store.status === "deleted") {
    throw createHttpError("Loja relacionada não encontrada", 404, undefined, "SUPPORT_STORE_NOT_FOUND");
  }

  if (actor.role === "seller" && store.owner?.toString() !== actor._id.toString()) {
    throw createHttpError(
      "Loja relacionada não pertence ao seller",
      403,
      undefined,
      "SUPPORT_STORE_FORBIDDEN",
    );
  }
};

const markSupportReadForActor = async (ticket, actor) => {
  const senderRole = getSenderRole(actor);
  const now = new Date();
  let changed = false;

  for (const message of ticket.messages ?? []) {
    if (message.senderRole !== senderRole && !message.isRead) {
      message.isRead = true;
      message.readAt = now;
      changed = true;
    }
  }

  if (!changed) return false;

  if (actor.role === "admin") {
    ticket.unreadCountPlatform = 0;
  } else {
    ticket.unreadCountRequester = 0;
  }

  await ticket.save();
  return true;
};

const notifyPlatformNewTicket = async (ticket, actor) => {
  const adminIds = await User.find({ role: "admin", status: "active" }).distinct("_id");

  await createNotificationsForUsers(adminIds, {
    title: "Novo ticket de suporte",
    message: `${actor.name ?? "Usuário"} abriu o ticket ${ticket.ticketNumber ?? ""}`.trim(),
    type: "support_ticket",
    recipientRole: "admin",
    actionUrl: `/support/tickets/${ticket._id}`,
    refModel: { refId: ticket._id, refModel: "Store" },
    metadata: {
      ticketNumber: ticket.ticketNumber,
      category: ticket.category,
      requesterType: ticket.requesterType,
    },
  });
};

const notifySupportMessage = async ({ ticket, senderRole, senderName }) => {
  if (senderRole === "admin") {
    await createNotificationForUser(ticket.requester, {
      title: "Atualização do suporte",
      message: `${senderName ?? "Suporte"} respondeu seu ticket ${ticket.ticketNumber}.`,
      type: "support_message",
      recipientRole: ticket.requesterType,
      actionUrl: `/support/tickets/${ticket._id}`,
      refModel: { refId: ticket._id, refModel: "Store" },
      metadata: { ticketNumber: ticket.ticketNumber },
    });

    return;
  }

  const adminIds = await User.find({ role: "admin", status: "active" }).distinct("_id");

  await createNotificationsForUsers(adminIds, {
    title: "Nova mensagem em ticket",
    message: `${senderName ?? "Requester"} enviou mensagem no ticket ${ticket.ticketNumber}.`,
    type: "support_message",
    recipientRole: "admin",
    actionUrl: `/support/tickets/${ticket._id}`,
    refModel: { refId: ticket._id, refModel: "Store" },
    metadata: { ticketNumber: ticket.ticketNumber },
  });
};

const notifySupportStatusChange = async ({ ticket, status, actorName }) => {
  await createNotificationForUser(ticket.requester, {
    title: "Status do suporte atualizado",
    message: `Ticket ${ticket.ticketNumber} atualizado para ${status} por ${actorName ?? "plataforma"}.`,
    type: "support_status",
    recipientRole: ticket.requesterType,
    actionUrl: `/support/tickets/${ticket._id}`,
    refModel: { refId: ticket._id, refModel: "Store" },
    metadata: { ticketNumber: ticket.ticketNumber, status },
  });
};

export const listSupportTickets = async (actor, query = {}) => {
  const { page, limit, skip } = normalizePagination(query);

  const filters = { channel: SUPPORT_CHANNEL };

  if (actor.role !== "admin") {
    filters.requester = actor._id;
  }

  if (query.status) filters.status = query.status;
  if (query.category) filters.category = query.category;

  const [items, total] = await Promise.all([
    Ticket.find(filters)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("requester", "name email role")
      .populate("assignedTo", "name email role")
      .populate("store", "name owner"),
    Ticket.countDocuments(filters),
  ]);

  return buildPaginationResult({
    items: items.map((item) => buildSupportSummary(item.toObject())),
    total,
    page,
    limit,
  });
};

export const createSupportTicket = async (actor, payload) => {
  const senderRole = getSenderRole(actor);

  if (!["customer", "seller", "admin"].includes(senderRole)) {
    throw createHttpError("Acesso proibido", 403, undefined, "SUPPORT_CREATE_FORBIDDEN");
  }

  const { text, attachments } = assertSupportMessagePayloadOrThrow(payload);
  assertNoInappropriateContentOrThrow(text);

  await ensureAntiSpamOrThrow({
    senderId: actor._id,
    scope: `create:${payload.category}`,
    text,
    attachments,
  });

  await ensureOrderOwnershipForRequesterOrThrow(actor, payload.orderId);
  await ensureStoreOwnershipForSellerOrThrow(actor, payload.storeId);

  const ticket = new Ticket({
    channel: SUPPORT_CHANNEL,
    user: actor._id,
    requester: actor._id,
    requesterType: senderRole,
    subject: payload.subject,
    category: payload.category,
    priority: payload.priority ?? SUPPORT_PRIORITY_BY_CATEGORY[payload.category] ?? "medium",
    status: "open",
    store: payload.storeId ?? null,
    order: payload.orderId ?? null,
    messages: [
      {
        senderRole,
        sender: actor._id,
        text,
        attachments,
        isRead: false,
        readAt: null,
      },
    ],
    lastMessageAt: new Date(),
    unreadCountRequester: 0,
    unreadCountPlatform: 1,
  });

  await ticket.save();
  await notifyPlatformNewTicket(ticket, actor);

  return {
    ticket: buildSupportSummary(ticket.toObject()),
    message: buildSupportMessages(ticket.toObject())[0],
  };
};

export const getSupportTicket = async (actor, ticketId) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  ensureSupportAccessOrThrow(ticket, actor);
  await markSupportReadForActor(ticket, actor);

  return {
    ticket: buildSupportSummary(ticket.toObject()),
    messages: buildSupportMessages(ticket.toObject()),
  };
};

export const sendSupportMessage = async (actor, ticketId, payload) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  ensureSupportAccessOrThrow(ticket, actor);
  ensureTicketNotBlockedOrThrow(ticket, actor);

  const senderRole = getSenderRole(actor);
  const { text, attachments } = assertSupportMessagePayloadOrThrow(payload);
  assertNoInappropriateContentOrThrow(text);

  await ensureAntiSpamOrThrow({
    senderId: actor._id,
    scope: `ticket:${ticket._id}`,
    text,
    attachments,
  });

  ticket.messages.push({
    senderRole,
    sender: actor._id,
    text,
    attachments,
    isRead: false,
    readAt: null,
  });
  ticket.lastMessageAt = new Date();

  if (senderRole === "admin") {
    ticket.unreadCountRequester = Number(ticket.unreadCountRequester ?? 0) + 1;
    if (["open", "triage", "waiting_internal", "reopened"].includes(ticket.status)) {
      ticket.status = "waiting_requester";
    }
  } else {
    ticket.unreadCountPlatform = Number(ticket.unreadCountPlatform ?? 0) + 1;
    if (["open", "waiting_requester", "reopened"].includes(ticket.status)) {
      ticket.status = "waiting_internal";
    }
  }

  await ticket.save();
  await notifySupportMessage({
    ticket,
    senderRole,
    senderName: actor.name,
  });

  return {
    ticket: buildSupportSummary(ticket.toObject()),
    message: buildSupportMessages(ticket.toObject()).at(-1),
  };
};

export const markSupportTicketAsRead = async (actor, ticketId) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  ensureSupportAccessOrThrow(ticket, actor);
  await markSupportReadForActor(ticket, actor);

  return buildSupportSummary(ticket.toObject());
};

export const assignSupportTicket = async (actor, ticketId, assigneeId) => {
  if (actor.role !== "admin") {
    throw createHttpError("Acesso proibido", 403, undefined, "SUPPORT_ASSIGN_FORBIDDEN");
  }

  const ticket = await ensureSupportTicketOrThrow(ticketId);

  if (!assigneeId) {
    ticket.assignedTo = actor._id;
  } else {
    const assignee = await User.findOne({ _id: assigneeId, role: "admin", status: "active" }).select("_id").lean();
    if (!assignee) {
      throw createHttpError("Responsável inválido", 400, undefined, "SUPPORT_ASSIGNEE_INVALID");
    }

    ticket.assignedTo = assignee._id;
  }

  if (ticket.status === "open") {
    ticket.status = "triage";
  }

  await ticket.save();

  return buildSupportSummary(ticket.toObject());
};

export const updateSupportTicketStatus = async (actor, ticketId, payload) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  const access = ensureSupportAccessOrThrow(ticket, actor);
  const nextStatus = payload.status;

  if (!nextStatus) {
    throw createHttpError("Status é obrigatório", 400, undefined, "SUPPORT_STATUS_REQUIRED");
  }

  if (access.isPlatform) {
    if (!SUPPORT_ADMIN_STATUSES.has(nextStatus)) {
      throw createHttpError("Status inválido", 400, undefined, "SUPPORT_STATUS_INVALID");
    }
  } else {
    const canRequesterReopen = nextStatus === "reopened" && ["resolved", "closed"].includes(ticket.status);
    if (!canRequesterReopen) {
      throw createHttpError("Acesso proibido para alterar este status", 403, undefined, "SUPPORT_STATUS_FORBIDDEN");
    }
  }

  ticket.status = nextStatus;

  if (nextStatus === "resolved") {
    ticket.resolvedAt = new Date();
    ticket.resolutionSummary = payload.resolutionSummary ?? ticket.resolutionSummary;
  }

  if (nextStatus === "closed") {
    ticket.closedAt = new Date();
  }

  if (nextStatus === "reopened") {
    ticket.closedAt = null;
    ticket.resolvedAt = null;
    ticket.resolutionSummary = null;
  }

  await ticket.save();

  if (actor.role === "admin") {
    await notifySupportStatusChange({
      ticket,
      status: nextStatus,
      actorName: actor.name,
    });
  }

  return buildSupportSummary(ticket.toObject());
};

export const blockSupportTicket = async (actor, ticketId) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  ensureSupportAccessOrThrow(ticket, actor);

  ticket.isBlocked = true;
  ticket.blockedBy = actor._id;
  ticket.blockedRole = getSenderRole(actor);
  ticket.blockedAt = new Date();

  await ticket.save();
  return buildSupportSummary(ticket.toObject());
};

export const unblockSupportTicket = async (actor, ticketId) => {
  const ticket = await ensureSupportTicketOrThrow(ticketId);
  ensureSupportAccessOrThrow(ticket, actor);

  if (
    actor.role !== "admin"
    && ticket.blockedBy
    && ticket.blockedBy.toString() !== actor._id.toString()
  ) {
    throw createHttpError(
      "Apenas quem bloqueou pode desbloquear o ticket",
      403,
      undefined,
      "SUPPORT_UNBLOCK_FORBIDDEN",
    );
  }

  ticket.isBlocked = false;
  ticket.blockedBy = null;
  ticket.blockedRole = null;
  ticket.blockedAt = null;

  await ticket.save();
  return buildSupportSummary(ticket.toObject());
};
