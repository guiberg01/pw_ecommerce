import { sendSuccess } from "../helpers/successResponse.js";
import {
  blockConversationForActor,
  getConversationMessagesForActor,
  listAllConversationsForAdmin,
  listConversationsForActor,
  markConversationAsReadForActor,
  sendMessageToConversation,
  startConversationForStore,
  unblockConversationForActor,
} from "../services/message.service.js";

export const getMyConversations = async (req, res, next) => {
  try {
    const result = await listConversationsForActor(req.user, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Conversas carregadas com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const getMyConversationMessages = async (req, res, next) => {
  try {
    const result = await getConversationMessagesForActor(req.user, req.params.id);
    return sendSuccess(res, 200, "Mensagens da conversa carregadas com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const postStartConversationWithStore = async (req, res, next) => {
  try {
    const result = await startConversationForStore(req.user, req.params.storeId, req.body);
    return sendSuccess(res, 201, "Conversa iniciada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const postSendMessageInConversation = async (req, res, next) => {
  try {
    const result = await sendMessageToConversation(req.user, req.params.id, req.body);
    return sendSuccess(res, 201, "Mensagem enviada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const patchReadConversation = async (req, res, next) => {
  try {
    const result = await markConversationAsReadForActor(req.user, req.params.id);
    return sendSuccess(res, 200, "Conversa marcada como lida", result);
  } catch (error) {
    return next(error);
  }
};

export const patchBlockConversation = async (req, res, next) => {
  try {
    const result = await blockConversationForActor(req.user, req.params.id);
    return sendSuccess(res, 200, "Conversa bloqueada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const patchUnblockConversation = async (req, res, next) => {
  try {
    const result = await unblockConversationForActor(req.user, req.params.id);
    return sendSuccess(res, 200, "Conversa desbloqueada com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const getAdminConversations = async (req, res, next) => {
  try {
    const result = await listAllConversationsForAdmin(req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Conversas globais carregadas com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const getAdminConversationMessages = async (req, res, next) => {
  try {
    const result = await getConversationMessagesForActor(req.user, req.params.id);
    return sendSuccess(res, 200, "Mensagens da conversa carregadas com sucesso", result);
  } catch (error) {
    return next(error);
  }
};
