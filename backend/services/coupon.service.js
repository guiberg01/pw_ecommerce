import { Coupon } from "../models/coupon.model.js";
import { createHttpError } from "../helpers/httpError.js";

let lastExpiration = null;
const INTERVAL_HOUR = 60 * 60 * 1000;

export const findAllCoupons = async () => {
  const now = new Date();

  if (!lastExpiration || now - lastExpiration >= INTERVAL_HOUR) {
    await Coupon.updateMany({ expiresAt: { $lte: now }, status: "active" }, { status: "expired" });
    lastExpiration = now;
  }

  return Coupon.find({ status: { $in: ["active", "sold-out"] } })
    .populate("store", "name")
    .lean();
};

export const findCouponById = async (id) => {
  const coupon = await Coupon.findOne({ _id: id, status: { $nin: ["inactive", "expired"] } }).lean();

  if (!coupon) {
    throw createHttpError("Cupom não encontrado", 404, undefined, "COUPON_NOT_FOUND");
  }

  return coupon;
};
