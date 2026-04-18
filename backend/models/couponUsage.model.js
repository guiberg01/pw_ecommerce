import mongoose from "mongoose";

const couponUsageSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
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
    usedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true },
);

couponUsageSchema.index({ coupon: 1, user: 1, order: 1 }, { unique: true });

const CouponUsage = mongoose.model("CouponUsage", couponUsageSchema);

export default CouponUsage;
