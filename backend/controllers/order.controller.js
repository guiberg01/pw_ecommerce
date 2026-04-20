import { sendSuccess } from "../helpers/successResponse.js";
import { findOrderByIdForUserOrThrow, listOrdersForUser } from "../services/order.service.js";

export const getMyOrders = async (req, res, next) => {
  try {
    const { page, limit, status, createdFrom, createdTo, sort } = req.validatedQuery ?? {};
    const orders = await listOrdersForUser(req.user._id, { page, limit, status, createdFrom, createdTo, sort });

    return sendSuccess(res, 200, "Pedidos listados com sucesso", orders);
  } catch (error) {
    return next(error);
  }
};

export const getMyOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await findOrderByIdForUserOrThrow(id, req.user._id);

    return sendSuccess(res, 200, "Pedido encontrado com sucesso", order);
  } catch (error) {
    return next(error);
  }
};
