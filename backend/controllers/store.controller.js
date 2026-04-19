import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { sendSuccess } from "../helpers/successResponse.js";
import {
  ensureStoreHasNoActiveProducts,
  createStores,
  findActiveStoreByOwnerOrThrow,
  findStoreByIdOrThrow,
  listVisibleStores,
  softDeleteStore,
  updateStoreForOwner,
} from "../services/catalog.service.js";
import {
  createStripeOnboardingLinkForStoreOwner,
  getStripeConnectStatusForStoreOwner,
} from "../services/stripeConnect.service.js";

export const allStores = async (req, res, next) => {
  try {
    const { categoryId } = req.validatedQuery ?? {};
    const stores = await listVisibleStores({ categoryId });
    return sendSuccess(res, 200, "Lojas listadas com sucesso", stores);
  } catch (error) {
    return next(error);
  }
};

export const createStore = async (req, res, next) => {
  try {
    const store = await createStores(req.user._id, req.body);
    return sendSuccess(res, 201, "Loja criada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getMyStore = async (req, res, next) => {
  try {
    const store = await findActiveStoreByOwnerOrThrow(req.user._id);
    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getStoreById = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);
    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const updateMyStore = async (req, res, next) => {
  try {
    const store = await updateStoreForOwner(req.user._id, req.body);
    return sendSuccess(res, 200, "Loja atualizada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const deleteMyStore = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);

    if (!store.owner.equals(req.user._id)) {
      throw createHttpError("Apenas o dono da loja pode deletar esta loja", 403, undefined, "STORE_DELETE_FORBIDDEN");
    }

    await ensureStoreHasNoActiveProducts(storeId);
    await softDeleteStore(store._id);

    return sendSuccess(res, 200, "Loja deletada com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const createMyStoreStripeOnboardingLink = async (req, res, next) => {
  try {
    const onboarding = await createStripeOnboardingLinkForStoreOwner(req.user._id, req.body);
    return sendSuccess(res, 200, "Link de onboarding Stripe gerado com sucesso", onboarding);
  } catch (error) {
    return next(error);
  }
};

export const getMyStoreStripeConnectStatus = async (req, res, next) => {
  try {
    const status = await getStripeConnectStatusForStoreOwner(req.user._id);
    return sendSuccess(res, 200, "Status da conta Stripe obtido com sucesso", status);
  } catch (error) {
    return next(error);
  }
};
