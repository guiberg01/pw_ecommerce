import { sendSuccess } from "../helpers/successResponse.js";
import {
  assignSupportTicket,
  blockSupportTicket,
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  markSupportTicketAsRead,
  sendSupportMessage,
  unblockSupportTicket,
  updateSupportTicketStatus,
} from "../services/support.service.js";

export const getSupportTickets = async (req, res, next) => {
    const result = await listSupportTickets(req.user, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Tickets de suporte carregados com sucesso", result);
};

export const postSupportTicket = async (req, res, next) => {
    const result = await createSupportTicket(req.user, req.body);
    return sendSuccess(res, 201, "Ticket de suporte criado com sucesso", result);
};

export const getSupportTicketById = async (req, res, next) => {
    const result = await getSupportTicket(req.user, req.params.id);
    return sendSuccess(res, 200, "Ticket de suporte carregado com sucesso", result);
};

export const postSupportTicketMessage = async (req, res, next) => {
    const result = await sendSupportMessage(req.user, req.params.id, req.body);
    return sendSuccess(res, 201, "Mensagem de suporte enviada com sucesso", result);
};

export const patchSupportTicketRead = async (req, res, next) => {
    const result = await markSupportTicketAsRead(req.user, req.params.id);
    return sendSuccess(res, 200, "Ticket marcado como lido", result);
};

export const patchSupportTicketAssign = async (req, res, next) => {
    const result = await assignSupportTicket(req.user, req.params.id, req.body.assigneeId);
    return sendSuccess(res, 200, "Ticket atribuído com sucesso", result);
};

export const patchSupportTicketStatus = async (req, res, next) => {
    const result = await updateSupportTicketStatus(req.user, req.params.id, req.body);
    return sendSuccess(res, 200, "Status do ticket atualizado com sucesso", result);
};

export const patchSupportTicketBlock = async (req, res, next) => {
    const result = await blockSupportTicket(req.user, req.params.id);
    return sendSuccess(res, 200, "Ticket bloqueado com sucesso", result);
};

export const patchSupportTicketUnblock = async (req, res, next) => {
    const result = await unblockSupportTicket(req.user, req.params.id);
    return sendSuccess(res, 200, "Ticket desbloqueado com sucesso", result);
};
