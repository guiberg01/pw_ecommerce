import mongoose from "mongoose";

const paymentMethodSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    stripePaymentMethodId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    cardBrand: {
      type: String,
      default: null,
      trim: true,
    },
    last4: {
      type: String,
      default: null,
      trim: true,
    },
    expMonth: {
      type: Number,
      default: null,
      min: 1,
      max: 12,
    },
    expYear: {
      type: Number,
      default: null,
      min: 2000,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

paymentMethodSchema.index({ user: 1, stripePaymentMethodId: 1 }, { unique: true });

const PaymentMethod = mongoose.model("PaymentMethod", paymentMethodSchema);

export default PaymentMethod;
