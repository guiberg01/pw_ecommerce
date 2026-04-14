import { Router } from "express";
import { getAllCoupons, getCouponById } from "../controllers/coupon.controller.js";
import { validateParams } from "../middleware/validation.middleware.js";
import { couponIdParamsSchema } from "../validators/coupon.validator.js";

const router = Router();

router.get("/", getAllCoupons);
router.get("/:id", validateParams(couponIdParamsSchema), getCouponById);

export default router;
