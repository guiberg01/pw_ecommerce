import { sendSuccess } from "../helpers/successResponse.js";
import { createCheckoutIntentForUser, processStripeWebhookEvent } from "../services/checkout.service.js";
import { createHttpError } from "../helpers/httpError.js";

export const createCheckoutIntent = async (req, res, next) => {
  try {
    const checkoutIntent = await createCheckoutIntentForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Checkout iniciado com sucesso", checkoutIntent);
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
