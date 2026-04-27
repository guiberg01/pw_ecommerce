import { sendSuccess } from "../helpers/successResponse.js";
import {
  createPaymentMethodForUser,
  deletePaymentMethodForUser,
  findPaymentMethodByIdForUserOrThrow,
  listPaymentMethodsByUser,
  setDefaultPaymentMethodForUserById,
  updatePaymentMethodForUser,
} from "../services/paymentMethod.service.js";

export const getMyPaymentMethods = async (req, res, next) => {
    const paymentMethods = await listPaymentMethodsByUser(req.user._id);
    return sendSuccess(res, 200, "Métodos de pagamento listados com sucesso", paymentMethods);
};

export const getMyPaymentMethodById = async (req, res, next) => {
    const { id } = req.params;
    const paymentMethod = await findPaymentMethodByIdForUserOrThrow(id, req.user._id);
    return sendSuccess(res, 200, "Método de pagamento encontrado com sucesso", paymentMethod);
};

export const createMyPaymentMethod = async (req, res, next) => {
    const paymentMethod = await createPaymentMethodForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Método de pagamento criado com sucesso", paymentMethod);
};

export const updateMyPaymentMethod = async (req, res, next) => {
    const { id } = req.params;
    const paymentMethod = await updatePaymentMethodForUser(id, req.user._id, req.body);
    return sendSuccess(res, 200, "Método de pagamento atualizado com sucesso", paymentMethod);
};

export const setMyDefaultPaymentMethod = async (req, res, next) => {
    const { id } = req.params;
    const paymentMethod = await setDefaultPaymentMethodForUserById(id, req.user._id);
    return sendSuccess(res, 200, "Método de pagamento padrão atualizado com sucesso", paymentMethod);
};

export const deleteMyPaymentMethod = async (req, res, next) => {
    const { id } = req.params;
    await deletePaymentMethodForUser(id, req.user._id);
    return sendSuccess(res, 200, "Método de pagamento removido com sucesso");
};
