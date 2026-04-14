import { findAllCoupons, findCouponById } from "../services/coupon.service.js";
import { sendSuccess } from "../helpers/successResponse.js";

export const getAllCoupons = async (req, res, next) => {
  try {
    const allCoupons = await findAllCoupons();

    return sendSuccess(res, 200, "Cupons encontrados com sucesso", allCoupons);
  } catch (error) {
    return next(error);
  }
};

export const getCouponById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await findCouponById(id);

    return sendSuccess(res, 200, "Cupom encontrado com sucesso", coupon);
  } catch (error) {
    return next(error);
  }
};
