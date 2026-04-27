import mongoose from "mongoose";
// Garante o registro do model Category antes de populações em runtime.
import "./category.model.js";

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
      min: [1, "O valor do desconto deve ser maior que zero"],
      validate:
        {
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
    maxDiscountAmount: {
      type: Number,
      default: null,
      min: 0,
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
    products: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
      ],
      default: [],
    },
    stores: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Store",
          default: null,
        },
      ],
      default: [],
    },
    categories: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Category",
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "expired", "sold-out", "deleted"],
      default: "active",
    },
    scope: {
      type: String,
      enum: ["platform", "store"],
      default: "platform",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

couponSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
couponSchema.index({ stores: 1 });
couponSchema.index({ categories: 1 });
couponSchema.index({ scope: 1, status: 1 });

const Coupon = mongoose.model("Coupon", couponSchema);

export { Coupon };
export default Coupon;
