import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubOrder",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    videos: {
      type: [String],
      default: [],
    },
    sellerReply: {
      comment: {
        type: String,
        default: null,
      },
      repliedAt: {
        type: Date,
        default: null,
      },
      editedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true },
);

reviewSchema.index({ product: 1, user: 1, subOrder: 1 }, { unique: true });

const Review = mongoose.model("Review", reviewSchema);

export default Review;
