import { Router } from "express";
import { getMyOrderById, getMyOrders } from "../controllers/order.controller.js";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { validateParams, validateQuery } from "../middleware/validation.middleware.js";
import { orderIdParamSchema, orderListQuerySchema } from "../validators/order.validator.js";

const router = Router();

router.use(isLoggedIn);

router.get("/me", validateQuery(orderListQuerySchema), getMyOrders);
router.get("/:id", validateParams(orderIdParamSchema), getMyOrderById);

export default router;
