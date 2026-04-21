import mongoose from "mongoose";

const paymentMethodSnapshotSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      default: null,
    },
    brand: {
      type: String,
      default: null,
    },
    last4: {
      type: String,
      default: null,
    },
    installments: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    stripePaymentIntentId: {
      type: String,
      default: null,
      trim: true,
    },
    stripeChargeId: {
      type: String,
      default: null,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "BRL",
      uppercase: true,
      trim: true,
    },
    paymentMethod: {
      type: paymentMethodSnapshotSchema,
      default: {},
    },
    gatewayFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    platformRevenue: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "requires_action", "refunded", "partially_refunded"],
      default: "pending",
      index: true,
    },
    events: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    paidAt: {
      type: Date,
      default: null,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

paymentSchema.index({ order: 1, stripePaymentIntentId: 1 });
paymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ order: 1, status: 1, paidAt: -1, createdAt: -1 });
paymentSchema.index({ order: 1, createdAt: -1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
