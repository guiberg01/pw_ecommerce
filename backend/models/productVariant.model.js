import mongoose from "mongoose";

const productVariantSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    isMainVariant: {
      type: Boolean,
      default: false,
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    imageUrl: {
      type: String,
      default: null,
      trim: true,
    },
    datasheet: {
      type: String,
      default: null,
      trim: true,
    },
    weight: {
      type: Number,
      default: null,
      min: 0,
    },
    length: {
      type: Number,
      default: null,
      min: 0,
    },
    width: {
      type: Number,
      default: null,
      min: 0,
    },
    height: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  { timestamps: true },
);

productVariantSchema.index({ sku: 1 }, { unique: true });
productVariantSchema.index({ product: 1, stock: 1 });
productVariantSchema.index(
  { product: 1, isMainVariant: 1 },
  {
    unique: true,
    partialFilterExpression: { isMainVariant: true },
  },
);

const ProductVariant = mongoose.model("ProductVariant", productVariantSchema);

export default ProductVariant;
