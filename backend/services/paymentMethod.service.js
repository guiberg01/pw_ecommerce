import PaymentMethod from "../models/paymentMethod.model.js";
import { createHttpError } from "../helpers/httpError.js";

const PAYMENT_METHOD_SORT = { isDefault: -1, createdAt: -1 };

const ensurePaymentMethodBelongsToUserOrThrow = async (paymentMethodId, userId) => {
  const paymentMethod = await PaymentMethod.findOne({ _id: paymentMethodId, user: userId });

  if (!paymentMethod) {
    throw createHttpError("Método de pagamento não encontrado", 404, undefined, "PAYMENT_METHOD_NOT_FOUND");
  }

  return paymentMethod;
};

const setDefaultPaymentMethodForUser = async (userId, paymentMethodId) => {
  await PaymentMethod.updateMany({ user: userId, _id: { $ne: paymentMethodId } }, { $set: { isDefault: false } });
  await PaymentMethod.findOneAndUpdate({ _id: paymentMethodId, user: userId }, { $set: { isDefault: true } });
};

const ensureUserKeepsAtLeastOneDefaultPaymentMethod = async (userId) => {
  const currentDefault = await PaymentMethod.findOne({ user: userId, isDefault: true });
  if (currentDefault) return;

  const fallback = await PaymentMethod.findOne({ user: userId }).sort({ createdAt: -1 });
  if (fallback) {
    fallback.isDefault = true;
    await fallback.save();
  }
};

export const listPaymentMethodsByUser = async (userId) => {
  return PaymentMethod.find({ user: userId }).sort(PAYMENT_METHOD_SORT);
};

export const findPaymentMethodByIdForUserOrThrow = async (paymentMethodId, userId) => {
  return ensurePaymentMethodBelongsToUserOrThrow(paymentMethodId, userId);
};

export const createPaymentMethodForUser = async (userId, payload) => {
  const hasPaymentMethod = await PaymentMethod.exists({ user: userId });

  const paymentMethod = await PaymentMethod.create({
    ...payload,
    user: userId,
    isDefault: payload.isDefault ?? !hasPaymentMethod,
  });

  if (paymentMethod.isDefault) {
    await setDefaultPaymentMethodForUser(userId, paymentMethod._id);
  }

  return PaymentMethod.findById(paymentMethod._id);
};

export const updatePaymentMethodForUser = async (paymentMethodId, userId, payload) => {
  const paymentMethod = await ensurePaymentMethodBelongsToUserOrThrow(paymentMethodId, userId);

  Object.assign(paymentMethod, payload);
  await paymentMethod.save();

  if (payload.isDefault === true) {
    await setDefaultPaymentMethodForUser(userId, paymentMethod._id);
  }

  if (payload.isDefault === false) {
    await ensureUserKeepsAtLeastOneDefaultPaymentMethod(userId);
  }

  return PaymentMethod.findById(paymentMethod._id);
};

export const setDefaultPaymentMethodForUserById = async (paymentMethodId, userId) => {
  await ensurePaymentMethodBelongsToUserOrThrow(paymentMethodId, userId);
  await setDefaultPaymentMethodForUser(userId, paymentMethodId);

  return PaymentMethod.findById(paymentMethodId);
};

export const deletePaymentMethodForUser = async (paymentMethodId, userId) => {
  const paymentMethod = await ensurePaymentMethodBelongsToUserOrThrow(paymentMethodId, userId);
  await PaymentMethod.findByIdAndDelete(paymentMethod._id);

  if (paymentMethod.isDefault) {
    await ensureUserKeepsAtLeastOneDefaultPaymentMethod(userId);
  }
};
