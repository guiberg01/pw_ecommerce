import { Coupon } from "../models/coupon.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { isDuplicateFieldError } from "../helpers/slugUnique.helper.js";

const activeCouponStatuses = ["active", "sold-out"];

const validByExpirationFilter = (now) => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

export const markExpiredCoupons = async (now = new Date()) => {
  return Coupon.updateMany({ status: "active", expiresAt: { $ne: null, $lte: now } }, { $set: { status: "expired" } });
};

export const findAllCoupons = async () => {
  const now = new Date();

  return Coupon.find({
    status: { $in: activeCouponStatuses },
    ...validByExpirationFilter(now),
  })
    .populate("stores", "name slug status")
    .populate("categories", "name status")
    .lean();
};

export const findCouponById = async (id) => {
  const now = new Date();

  const coupon = await Coupon.findOne({
    _id: id,
    status: { $in: activeCouponStatuses },
    ...validByExpirationFilter(now),
  })
    .populate("stores", "name slug status")
    .populate("categories", "name status")
    .lean();

  if (!coupon) {
    const expiredCoupon = await Coupon.findOne({
      _id: id,
      status: { $in: activeCouponStatuses },
      expiresAt: { $ne: null, $lte: now },
    })
      .select("_id")
      .lean();

    if (expiredCoupon) {
      throw createHttpError("Cupom expirado", 404, undefined, "COUPON_EXPIRED");
    }

    throw createHttpError("Cupom não encontrado", 404, undefined, "COUPON_NOT_FOUND");
  }

  return coupon;
};

export const createCoupons = async (idUser, data) => {
  try {
    const coupon = new Coupon({ ...data, createdBy: idUser });
    await coupon.save();
    return coupon;
  } catch (error) {
    if (isDuplicateFieldError(error, "code")) {
      throw createHttpError(
        "Já existe um cupom com esse código",
        409,
        { field: "code", value: data?.code },
        "COUPON_CODE_CONFLICT",
      );
    }

    throw error;
  }
};
