import { sendSuccess } from "../helpers/successResponse.js";
import { createCheckoutIntentForUser } from "../services/checkout.service.js";

export const createCheckoutIntent = async (req, res, next) => {
  try {
    const checkoutIntent = await createCheckoutIntentForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Checkout iniciado com sucesso", checkoutIntent);
  } catch (error) {
    return next(error);
  }
};
