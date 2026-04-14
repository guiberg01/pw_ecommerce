import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
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
          productId: {
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
