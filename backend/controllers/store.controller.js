import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { sendSuccess } from "../helpers/successResponse.js";
import melhorenvioService from "../services/melhorenvio.service.js";
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
  dispatchPendingPayoutTransfersForStoreOwner,
  getStripeConnectStatusForStoreOwner,
} from "../services/stripeConnect.service.js";
import { notifyStoreVisitMilestone } from "../services/notification.service.js";

export const allStores = async (req, res, next) => {
    const { categoryId, page, limit } = req.validatedQuery ?? {};
    const stores = await listVisibleStores({ categoryId, page, limit });
    return sendSuccess(res, 200, "Lojas listadas com sucesso", stores);
};

export const createStore = async (req, res, next) => {
    const store = await createStores(req.user._id, req.body);
    const melhorEnvioOnboardingUrl = melhorenvioService.generateAuthorizationUrl(store._id.toString());

    return sendSuccess(res, 201, "Loja criada com sucesso", {
      ...store.toObject(),
      melhorEnvioOnboardingUrl,
    });
};

export const getMyStore = async (req, res, next) => {
    const store = await findActiveStoreByOwnerOrThrow(req.user._id);
    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
};

export const getStoreById = async (req, res, next) => {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);

    // Melhor esforço: contabiliza visitas sem interromper resposta ao cliente.
    const visitsCount = Number(store.visitsCount ?? 0) + 1;
    const lastMilestone = Number(store.lastVisitMilestoneNotified ?? 0);
    const currentMilestone = Math.floor(visitsCount / 50) * 50;

    void Store.updateOne(
      { _id: store._id },
      {
        $set: {
          visitsCount,
          ...(currentMilestone > 0 && currentMilestone > lastMilestone
            ? { lastVisitMilestoneNotified: currentMilestone }
            : {}),
        },
      },
    )
      .then(async () => {
        if (currentMilestone > 0 && currentMilestone > lastMilestone) {
          await notifyStoreVisitMilestone({
            storeId: store._id,
            ownerId: store.owner?._id ?? store.owner,
            visitsCount: currentMilestone,
          });
        }
      })
      .catch(() => {
        // Ignore falhas de telemetria de visita para não degradar endpoint público.
      });

    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
};

export const updateMyStore = async (req, res, next) => {
    const store = await updateStoreForOwner(req.user._id, req.body);
    return sendSuccess(res, 200, "Loja atualizada com sucesso", store);
};

export const deleteMyStore = async (req, res, next) => {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);

    if (!store.owner.equals(req.user._id)) {
      throw createHttpError("Apenas o dono da loja pode deletar esta loja", 403, undefined, "STORE_DELETE_FORBIDDEN");
    }

    await ensureStoreHasNoActiveProducts(storeId);
    await softDeleteStore(store._id);

    return sendSuccess(res, 200, "Loja deletada com sucesso");
};

export const createMyStoreStripeOnboardingLink = async (req, res, next) => {
    const onboarding = await createStripeOnboardingLinkForStoreOwner(req.user._id, req.body);
    return sendSuccess(res, 200, "Link de onboarding Stripe gerado com sucesso", onboarding);
};

export const getMyStoreStripeConnectStatus = async (req, res, next) => {
    const status = await getStripeConnectStatusForStoreOwner(req.user._id);
    return sendSuccess(res, 200, "Status da conta Stripe obtido com sucesso", status);
};

export const postMyStoreStripePayoutDispatch = async (req, res, next) => {
    const result = await dispatchPendingPayoutTransfersForStoreOwner(req.user._id);
    return sendSuccess(res, 200, "Transferências pendentes disparadas com sucesso", result);
};
