import { Coupon } from "../models/coupon.model.js";

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
