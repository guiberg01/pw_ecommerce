import mongoose from "mongoose";

const subOrderSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    items: {
      type: [
        {
          productVariantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            required: true,
          },
          name: {
            type: String,
            required: true,
            trim: true,
          },
          sku: {
            type: String,
            required: true,
            trim: true,
          },
          price: {
            type: Number,
            required: true,
            min: 0,
          },
          quantity: {
            type: Number,
            required: true,
            min: 1,
          },
          imageUrl: {
            type: String,
            default: null,
            trim: true,
          },
        },
      ],
      default: [],
    },
    coupon: {
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
      scope: {
        type: String,
        enum: ["platform", "store"],
        default: null,
      },
    },
    shipping: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shipping",
      default: null,
    },
    subTotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    shippingCost: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vendorNetAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "processing", "shipping", "delivered", "cancelled", "failed"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

subOrderSchema.index({ order: 1, store: 1 });

const SubOrder = mongoose.model("SubOrder", subOrderSchema);

export default SubOrder;
