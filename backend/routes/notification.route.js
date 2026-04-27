import { Router } from "express";
import {
  getMyNotifications,
  getMyUnreadNotificationCount,
  patchAllNotificationsRead,
  patchNotificationRead,
  postAdminBroadcastNotification,
  postAdminCartReminderRun,
  postNotificationClick,
  removeAllNotifications,
  removeNotification,
} from "../controllers/notification.controller.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import {
  adminBroadcastNotificationSchema,
  notificationIdParamSchema,
  notificationListQuerySchema,
} from "../validators/notification.validator.js";

const router = Router();

router.get("/", isLoggedIn, validateQuery(notificationListQuerySchema), getMyNotifications);
router.get("/unread-count", isLoggedIn, getMyUnreadNotificationCount);
router.patch("/read-all", isLoggedIn, patchAllNotificationsRead);
router.patch("/:id/read", isLoggedIn, validateParams(notificationIdParamSchema), patchNotificationRead);
router.post("/:id/click", isLoggedIn, validateParams(notificationIdParamSchema), postNotificationClick);
router.delete("/", isLoggedIn, removeAllNotifications);
router.delete("/:id", isLoggedIn, validateParams(notificationIdParamSchema), removeNotification);

router.post(
  "/admin/broadcast",
  isLoggedIn,
  isAdmin,
  validateBody(adminBroadcastNotificationSchema),
  postAdminBroadcastNotification,
);
router.post("/admin/reminders/carts", isLoggedIn, isAdmin, postAdminCartReminderRun);

export default router;
