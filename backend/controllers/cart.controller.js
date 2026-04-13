import { sendSuccess } from "../helpers/successResponse.js";
import {
  addProductToCartForRequest,
  clearCartForRequest,
  decrementProductForRequest,
  getCartForRequest,
  removeProductFromCartForRequest,
  updateProductQuantityForRequest,
} from "../services/cart.service.js";

export const getCart = async (req, res, next) => {
  try {
    const response = await getCartForRequest(req, res);

    return sendSuccess(res, 200, "Carrinho encontrado com sucesso", response);
  } catch (error) {
    return next(error);
  }
};

export const addToCart = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity = 1 } = req.body;
    const response = await addProductToCartForRequest(req, res, productId, quantity);

    return sendSuccess(res, 200, "Produto adicionado ao carrinho com sucesso", response);
  } catch (error) {
    return next(error);
  }
};

export const updateCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;
    const response = await updateProductQuantityForRequest(req, res, productId, quantity);

    return sendSuccess(res, 200, "Item do carrinho atualizado com sucesso", response);
  } catch (error) {
    return next(error);
  }
};

export const removeCartItemByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const response = await removeProductFromCartForRequest(req, res, productId);

    return sendSuccess(res, 200, "Item removido do carrinho com sucesso", response);
  } catch (error) {
    return next(error);
  }
};

export const removeAllCart = async (req, res, next) => {
  try {
    const response = await clearCartForRequest(req, res);

    return sendSuccess(res, 200, "Carrinho esvaziado com sucesso", response);
  } catch (error) {
    return next(error);
  }
};

export const decrementCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const response = await decrementProductForRequest(req, res, productId);

    return sendSuccess(res, 200, "Item do carrinho decrementado com sucesso", response);
  } catch (error) {
    return next(error);
  }
};
