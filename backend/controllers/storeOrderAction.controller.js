import { sendSuccess } from "../helpers/successResponse.js";
import { updateSellerOrderStatus } from "../services/storeOrderAction.service.js";

export const updateMyStoreOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const order = await updateSellerOrderStatus(req.user._id, orderId, { status });

    return sendSuccess(res, 200, "Status do pedido atualizado com sucesso", order);
  } catch (error) {
    return next(error);
  }
};
