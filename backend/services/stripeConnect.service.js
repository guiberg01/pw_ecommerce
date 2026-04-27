import Stripe from "stripe";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { dispatchPendingPayoutTransfersForStore } from "./checkout.service.js";

const stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const inFlightStripeAccountProvisionByStore = new Map();

const getStripeClientOrThrow = () => {
  if (!stripeClient) {
    throw createHttpError("Stripe não configurado", 500, undefined, "STRIPE_NOT_CONFIGURED");
  }

  return stripeClient;
};

const findStoreByOwnerOrThrow = async (ownerId) => {
  const store = await Store.findOne({ owner: ownerId, status: { $ne: "deleted" } });

  if (!store) {
    throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
  }

  return store;
};

const ensureStripeAccountForStore = async (store) => {
  if (store.stripeConnectId) {
    return store.stripeConnectId;
  }

  const storeKey = store._id.toString();
  if (inFlightStripeAccountProvisionByStore.has(storeKey)) {
    return inFlightStripeAccountProvisionByStore.get(storeKey);
  }

  const accountProvisionPromise = (async () => {
    const freshStore = await Store.findById(store._id).select("stripeConnectId owner");
    if (!freshStore) {
      throw createHttpError("Loja não encontrada", 404, undefined, "STORE_NOT_FOUND");
    }

    if (freshStore.stripeConnectId) {
      return freshStore.stripeConnectId;
    }

    const stripe = getStripeClientOrThrow();
    const account = await stripe.accounts.create({
      type: "express",
      country: "BR",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        storeId: freshStore._id.toString(),
        ownerId: freshStore.owner.toString(),
      },
    });

    const updatedStore = await Store.findOneAndUpdate(
      {
        _id: freshStore._id,
        $or: [{ stripeConnectId: { $exists: false } }, { stripeConnectId: null }, { stripeConnectId: "" }],
      },
      { $set: { stripeConnectId: account.id } },
      { new: true },
    ).select("stripeConnectId");

    if (updatedStore?.stripeConnectId) {
      return updatedStore.stripeConnectId;
    }

    const storeWithAccount = await Store.findById(freshStore._id).select("stripeConnectId");
    if (storeWithAccount?.stripeConnectId) {
      return storeWithAccount.stripeConnectId;
    }

    return account.id;
  })();

  inFlightStripeAccountProvisionByStore.set(storeKey, accountProvisionPromise);

  try {
    return await accountProvisionPromise;
  } finally {
    inFlightStripeAccountProvisionByStore.delete(storeKey);
  }
};

export const createStripeOnboardingLinkForStoreOwner = async (ownerId, { refreshUrl, returnUrl }) => {
  const store = await findStoreByOwnerOrThrow(ownerId);
  const accountId = await ensureStripeAccountForStore(store);

  const stripe = getStripeClientOrThrow();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: refreshUrl,
    return_url: returnUrl,
  });

  return {
    storeId: store._id,
    stripeConnectId: accountId,
    onboardingUrl: link.url,
    expiresAt: link.expires_at,
  };
};

export const getStripeConnectStatusForStoreOwner = async (ownerId) => {
  const store = await findStoreByOwnerOrThrow(ownerId);

  if (!store.stripeConnectId) {
    return {
      storeId: store._id,
      stripeConnectId: null,
      isConfigured: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      currentlyDue: [],
      pendingVerification: [],
      disabledReason: null,
    };
  }

  const stripe = getStripeClientOrThrow();
  const account = await stripe.accounts.retrieve(store.stripeConnectId);

  return {
    storeId: store._id,
    stripeConnectId: store.stripeConnectId,
    isConfigured: true,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    currentlyDue: account.requirements?.currently_due ?? [],
    pendingVerification: account.requirements?.pending_verification ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
};

export const dispatchPendingPayoutTransfersForStoreOwner = async (ownerId) => {
  const store = await findStoreByOwnerOrThrow(ownerId);
  await dispatchPendingPayoutTransfersForStore(store._id);

  return {
    storeId: store._id,
    dispatched: true,
  };
};
