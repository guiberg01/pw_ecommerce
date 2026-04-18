import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    stripePaymentId: {
      type: String,
      default: null,
      trim: true,
    },
    totalPriceProducts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    totalPaidByCustomer: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    totalShippingPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    totalDiscount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    shippingAddress: {
      type: {
        label: { type: String, default: null },
        zipCode: { type: String, required: true },
        street: { type: String, required: true },
        number: { type: String, required: true },
        complement: { type: String, default: null },
        neighborhood: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        receiverName: { type: String, required: true },
        phoneNumber: { type: String, required: true },
        location: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: {
            type: [Number],
            default: [0, 0],
          },
        },
      },
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

orderSchema.virtual("subOrder", {
  ref: "SubOrder",
  localField: "_id",
  foreignField: "order",
});

orderSchema.index({ user: 1, createdAt: -1 });

const Order = mongoose.model("Order", orderSchema);

export default Order;
