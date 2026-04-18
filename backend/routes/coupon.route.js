import { Router } from "express";
import { getAllCoupons, getCouponById, createCoupon } from "../controllers/coupon.controller.js";
import { validateParams, validateBody } from "../middleware/validation.middleware.js";
import { couponIdParamsSchema, createCouponSchema } from "../validators/coupon.validator.js";
import { isAdmin, isLoggedIn } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", getAllCoupons);
router.get("/:id", validateParams(couponIdParamsSchema), getCouponById);
router.post("/", isLoggedIn, isAdmin, validateBody(createCouponSchema), createCoupon);

export default router;
