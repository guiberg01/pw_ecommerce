import Stripe from "stripe";
import Store from "../models/store.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { dispatchPendingPayoutTransfersForStore } from "./checkout.service.js";

const stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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

  const stripe = getStripeClientOrThrow();

  const account = await stripe.accounts.create({
    type: "express",
    country: "BR",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      storeId: store._id.toString(),
      ownerId: store.owner.toString(),
    },
  });

  store.stripeConnectId = account.id;
  await store.save();

  return account.id;
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

  if (account.charges_enabled && account.payouts_enabled) {
    await dispatchPendingPayoutTransfersForStore(store._id);
  }

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
