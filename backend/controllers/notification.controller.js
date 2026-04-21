import { sendSuccess } from "../helpers/successResponse.js";
import {
  clickNotification,
  createAdminBroadcastNotification,
  deleteAllNotifications,
  deleteNotification,
  getUnreadNotificationCount,
  listNotificationsForUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  notifyUsersWithActiveCart,
} from "../services/notification.service.js";

export const getMyNotifications = async (req, res, next) => {
  try {
    const result = await listNotificationsForUser(req.user._id, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Notificações carregadas com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const getMyUnreadNotificationCount = async (req, res, next) => {
  try {
    const result = await getUnreadNotificationCount(req.user._id);
    return sendSuccess(res, 200, "Total de não lidas carregado com sucesso", result);
  } catch (error) {
    return next(error);
  }
};

export const patchNotificationRead = async (req, res, next) => {
  try {
    const notification = await markNotificationAsRead(req.user._id, req.params.id);
    return sendSuccess(res, 200, "Notificação marcada como lida", notification);
  } catch (error) {
    return next(error);
  }
};

export const patchAllNotificationsRead = async (req, res, next) => {
  try {
    const result = await markAllNotificationsAsRead(req.user._id);
    return sendSuccess(res, 200, "Todas as notificações foram marcadas como lidas", result);
  } catch (error) {
    return next(error);
  }
};

export const postNotificationClick = async (req, res, next) => {
  try {
    const result = await clickNotification(req.user._id, req.params.id);
    return sendSuccess(res, 200, "Notificação clicada", result);
  } catch (error) {
    return next(error);
  }
};

export const removeNotification = async (req, res, next) => {
  try {
    const result = await deleteNotification(req.user._id, req.params.id);
    return sendSuccess(res, 200, "Notificação removida", result);
  } catch (error) {
    return next(error);
  }
};

export const removeAllNotifications = async (req, res, next) => {
  try {
    const result = await deleteAllNotifications(req.user._id);
    return sendSuccess(res, 200, "Todas as notificações foram removidas", result);
  } catch (error) {
    return next(error);
  }
};

export const postAdminBroadcastNotification = async (req, res, next) => {
  try {
    const result = await createAdminBroadcastNotification(req.body);
    return sendSuccess(res, 201, "Notificação administrativa enviada", result);
  } catch (error) {
    return next(error);
  }
};

export const postAdminCartReminderRun = async (req, res, next) => {
  try {
    const result = await notifyUsersWithActiveCart();
    return sendSuccess(res, 200, "Lembretes de carrinho processados", result);
  } catch (error) {
    return next(error);
  }
};
