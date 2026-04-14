import { findAllCoupons } from "../services/coupon.service.js";
import { sendSuccess } from "../helpers/responseHandler.js";

export const getAllCoupons = async (req, res, next) => {
  try {
    const allCoupons = await findAllCoupons();

    return sendSuccess(res, 200, "Cupons encontrados com sucesso", allCoupons);
  } catch (error) {
    return next(error);
  }
};
