import { sendSuccess } from "../helpers/successResponse.js";
import {
  createCheckoutIntentForUser,
  getCheckoutShippingOptionsForUser,
  processStripeWebhookEvent,
  reconcileCheckoutOrderPaymentForUser,
  resumeCheckoutIntentForUser,
} from "../services/checkout.service.js";
import { createHttpError } from "../helpers/httpError.js";

export const getCheckoutShippingOptions = async (req, res, next) => {
  try {
    const options = await getCheckoutShippingOptionsForUser(req.user._id, req.body);
    return sendSuccess(res, 200, "Opções de frete obtidas com sucesso", options);
  } catch (error) {
    return next(error);
  }
};

export const createCheckoutIntent = async (req, res, next) => {
  try {
    const checkoutIntent = await createCheckoutIntentForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Checkout iniciado com sucesso", checkoutIntent);
  } catch (error) {
    return next(error);
  }
};

export const resumeCheckoutIntent = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const checkoutIntent = await resumeCheckoutIntentForUser(req.user._id, orderId);
    return sendSuccess(res, 200, "Checkout retomado com sucesso", checkoutIntent);
  } catch (error) {
    return next(error);
  }
};

export const reconcileCheckoutOrderPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const result = await reconcileCheckoutOrderPaymentForUser(req.user._id, orderId);
    return sendSuccess(res, 200, "Reconciliação de pagamento concluída", result);
  } catch (error) {
    return next(error);
  }
};

export const handleStripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"];
    const payloadBuffer = req.rawBody;

    if (!payloadBuffer) {
      throw createHttpError(
        "Payload bruto não disponível para webhook",
        400,
        undefined,
        "STRIPE_WEBHOOK_RAW_BODY_MISSING",
      );
    }

    const result = await processStripeWebhookEvent({
      payloadBuffer,
      signature,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
