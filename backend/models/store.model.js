import mongoose from "mongoose";
import { slugify } from "../helpers/slugUnique.helper.js";

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "O nome da loja é obrigatório"],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    cnpj: {
      type: String,
      default: null,
      trim: true,
    },
    logoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
      enum: ["active", "suspended", "blocked", "deleted", "pending"],
      default: "active",
    },
    reputation: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    stripeConnectId: {
      type: String,
      default: null,
      trim: true,
    },
    commissionRate: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    address: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      default: null,
    },
    visitsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastVisitMilestoneNotified: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

storeSchema.pre("validate", function () {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
});

storeSchema.index(
  { owner: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: "deleted" } },
  },
);

storeSchema.index({ cnpj: 1 }, { unique: true, sparse: true });

storeSchema.virtual("product", {
  ref: "Product",
  localField: "_id",
  foreignField: "store",
});

const Store = mongoose.model("Store", storeSchema);

export default Store;
