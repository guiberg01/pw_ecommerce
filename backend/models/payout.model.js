import mongoose from "mongoose";
import { payoutStatuses } from "../constants/payoutStatuses.js";

const payoutSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    subOrders: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SubOrder",
        },
      ],
      default: [],
    },
    stripePayoutId: {
      type: String,
      default: null,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    payday: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(payoutStatuses),
      default: payoutStatuses.PENDING,
      index: true,
    },
    failureMessage: {
      type: String,
      default: null,
      trim: true,
    },
    statementReceipt: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true },
);

const Payout = mongoose.model("Payout", payoutSchema);

export default Payout;
