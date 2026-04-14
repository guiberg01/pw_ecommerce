import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: [0.01, "O valor do desconto deve ser maior que zero"],
      validate: {
        validator: function (value) {
          if (this.discountType === "percentage") {
            return value <= 100;
          }
          return true;
        },
        message: "Desconto percentual não pode ultrapassar 100%",
      },
    },
    minOrderValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUses: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    maxUsesPerUser: {
      type: Number,
      default: 1,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "expired", "sold-out"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

couponSchema.index({ expiresAt: 1 });
couponSchema.index({ store: 1 });

const Coupon = mongoose.model("Coupon", couponSchema);

const couponUsageSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    //PROVAVEL QUANDO TER ORDER: order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true },
);

couponUsageSchema.index({ coupon: 1, user: 1 });

const CouponUsage = mongoose.model("CouponUsage", couponUsageSchema);

export { Coupon, CouponUsage };
