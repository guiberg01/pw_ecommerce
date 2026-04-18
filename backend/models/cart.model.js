import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    productVariant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductVariant",
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    appliedCoupon: {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Coupon",
        default: null,
      },
      code: {
        type: String,
        default: null,
      },
      discountType: {
        type: String,
        enum: ["percentage", "fixed"],
        default: null,
      },
      discountValue: {
        type: Number,
        default: null,
      },
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
    auditTrail: {
      type: [
        {
          at: {
            type: Date,
            required: true,
          },
          productVariantId: {
            type: String,
            required: true,
          },
          reason: {
            type: String,
            required: true,
          },
          quantity: {
            type: Number,
            required: true,
          },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

const Cart = mongoose.model("Cart", cartSchema);

export default Cart;
