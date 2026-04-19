import { Router } from "express";
import {
  createMyPaymentMethod,
  deleteMyPaymentMethod,
  getMyPaymentMethodById,
  getMyPaymentMethods,
  setMyDefaultPaymentMethod,
  updateMyPaymentMethod,
} from "../controllers/paymentMethod.controller.js";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import {
  createPaymentMethodSchema,
  paymentMethodIdParamSchema,
  updatePaymentMethodSchema,
} from "../validators/paymentMethod.validator.js";

const router = Router();

router.use(isLoggedIn);

router.get("/", getMyPaymentMethods);
router.get("/:id", validateParams(paymentMethodIdParamSchema), getMyPaymentMethodById);
router.post("/", validateBody(createPaymentMethodSchema), createMyPaymentMethod);
router.put(
  "/:id",
  validateParams(paymentMethodIdParamSchema),
  validateBody(updatePaymentMethodSchema),
  updateMyPaymentMethod,
);
router.patch("/:id/default", validateParams(paymentMethodIdParamSchema), setMyDefaultPaymentMethod);
router.delete("/:id", validateParams(paymentMethodIdParamSchema), deleteMyPaymentMethod);

export default router;
