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
    const options = await getCheckoutShippingOptionsForUser(req.user._id, req.body);
    return sendSuccess(res, 200, "Opções de frete obtidas com sucesso", options);
};

export const createCheckoutIntent = async (req, res, next) => {
    const checkoutIntent = await createCheckoutIntentForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Checkout iniciado com sucesso", checkoutIntent);
};

export const resumeCheckoutIntent = async (req, res, next) => {
    const { orderId } = req.params;
    const checkoutIntent = await resumeCheckoutIntentForUser(req.user._id, orderId);
    return sendSuccess(res, 200, "Checkout retomado com sucesso", checkoutIntent);
};

export const reconcileCheckoutOrderPayment = async (req, res, next) => {
    const { orderId } = req.params;
    const result = await reconcileCheckoutOrderPaymentForUser(req.user._id, orderId);
    return sendSuccess(res, 200, "Reconciliação de pagamento concluída", result);
};

export const handleStripeWebhook = async (req, res, next) => {
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
};
