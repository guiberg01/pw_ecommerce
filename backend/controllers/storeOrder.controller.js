import { sendSuccess } from "../helpers/successResponse.js";
import { findSellerOrderByIdOrThrow, listOrdersForSeller } from "../services/storeOrder.service.js";

export const getMyStoreOrders = async (req, res, next) => {
  try {
    const { page, limit, orderStatus, subOrderStatus, createdFrom, createdTo, sort } = req.validatedQuery ?? {};
    const orders = await listOrdersForSeller(req.user._id, {
      page,
      limit,
      orderStatus,
      subOrderStatus,
      createdFrom,
      createdTo,
      sort,
    });

    return sendSuccess(res, 200, "Pedidos da loja listados com sucesso", orders);
  } catch (error) {
    return next(error);
  }
};

export const getMyStoreOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await findSellerOrderByIdOrThrow(req.user._id, orderId);

    return sendSuccess(res, 200, "Pedido da loja encontrado com sucesso", order);
  } catch (error) {
    return next(error);
  }
};