export const getAllCoupons = async (req, res, next) => {
  try {
    const visibleCoupons = await findAllCoupons();

    return sendSuccess(res, 200, "Cupons encontrados com sucesso", visibleCoupons);
  } catch (error) {
    next(error);
  }
};
