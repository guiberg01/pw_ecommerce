import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "O nome do produto é obrigatório"],
    },
    description: {
      type: String,
      required: [true, "A descrição do produto é obrigatória"],
    },
    basePrice: {
      type: Number,
      required: [true, "O preço do produto é obrigatório"],
      min: [0, "O preço do produto deve ser um valor positivo"],
    },
    mainImageUrl: {
      type: String,
      required: [true, "A URL da imagem do produto é obrigatória"],
    },
    category: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: [true, "A categoria do produto é obrigatória"],
        index: true,
      },
    ],
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "A loja do produto é obrigatória"],
      index: true,
    },
    highlighted: {
      type: Boolean,
      default: false,
    },
    maxPerPerson: {
      type: Number,
      min: [1, "Limite máximo deve ser ao menos 1"],
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "blocked", "deleted"],
      default: "active",
    },
    rating: {
      ratingSum: {
        type: Number,
        default: 0,
        min: 0,
      },
      ratingCount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

productSchema.virtual("productVariants", {
  ref: "ProductVariant",
  localField: "_id",
  foreignField: "product",
  match: { isMainVariant: false },
});

productSchema.virtual("mainVariant", {
  ref: "ProductVariant",
  localField: "_id",
  foreignField: "product",
  justOne: true,
  match: { isMainVariant: true },
});

productSchema.virtual("rating.average").get(function () {
  const sum = Number(this.rating?.ratingSum ?? 0);
  const count = Number(this.rating?.ratingCount ?? 0);

  if (!count) return 0;
  return Math.round((sum / count) * 100) / 100;
});

productSchema.index({ status: 1, store: 1, category: 1 });

const Product = mongoose.model("Product", productSchema);

export default Product;
