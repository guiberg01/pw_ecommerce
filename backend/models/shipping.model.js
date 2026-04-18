import mongoose from "mongoose";

const shippingSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    subOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubOrder",
      required: true,
      index: true,
    },
    shippingServiceInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    trackingCode: {
      type: String,
      default: null,
      trim: true,
    },
    melhorEnvioOrderId: {
      type: String,
      default: null,
      trim: true,
    },
    labelUrl: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "posted", "in_transit", "delivered", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    history: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    dimensions: {
      weight: { type: Number, default: null, min: 0 },
      length: { type: Number, default: null, min: 0 },
      width: { type: Number, default: null, min: 0 },
      height: { type: Number, default: null, min: 0 },
    },
  },
  { timestamps: true },
);

const Shipping = mongoose.model("Shipping", shippingSchema);

export default Shipping;
