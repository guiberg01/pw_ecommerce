import Coupon from "../models/coupon.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { isDuplicateFieldError } from "../helpers/slugUnique.helper.js";

const activeCouponStatuses = ["active", "sold-out"];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const validByExpirationFilter = (now) => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

const normalizePagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limit)))
    : DEFAULT_LIMIT;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
  };
};

const buildPaginationResult = (items, total, page, limit) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  },
});

export const markExpiredCoupons = async (now = new Date()) => {
  return Coupon.updateMany({ status: "active", expiresAt: { $ne: null, $lte: now } }, { $set: { status: "expired" } });
};

export const findAllCoupons = async ({ page, limit } = {}) => {
  const now = new Date();
  const pagination = normalizePagination({ page, limit });
  const skip = (pagination.page - 1) * pagination.limit;

  const filters = {
    status: { $in: activeCouponStatuses },
    ...validByExpirationFilter(now),
  };

  const [items, total] = await Promise.all([
    Coupon.find(filters)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .populate("stores", "name slug status")
      .populate("categories", "name status")
      .lean(),
    Coupon.countDocuments(filters),
  ]);

  return buildPaginationResult(items, total, pagination.page, pagination.limit);
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
