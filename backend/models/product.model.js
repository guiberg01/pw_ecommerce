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
    price: {
      type: Number,
      min: [0, "O preço do produto deve ser um valor positivo"],
      default: null,
    },
    imageUrl: {
      type: String,
      default: null,
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
    stock: {
      type: Number,
      default: 0,
      min: [0, "A quantidade em estoque do produto não pode ser negativa"],
    },
    maxPerPerson: {
      type: Number,
      min: [1, "Limite máximo deve ser ao menos 1"],
      validate: {
        validator: function (value) {
          if (value == null || this.stock == null) {
            return true;
          }

          return value <= this.stock;
        },
        message: "O limite máximo por pessoa não pode ser maior que o estoque",
      },
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

productSchema.pre("validate", function () {
  if ((this.basePrice == null || Number.isNaN(this.basePrice)) && this.price != null) {
    this.basePrice = this.price;
  }

  if (!this.mainImageUrl && this.imageUrl) {
    this.mainImageUrl = this.imageUrl;
  }

  if (this.price == null && this.basePrice != null) {
    this.price = this.basePrice;
  }

  if (!this.imageUrl && this.mainImageUrl) {
    this.imageUrl = this.mainImageUrl;
  }
});

productSchema.virtual("productVariants", {
  ref: "ProductVariant",
  localField: "_id",
  foreignField: "product",
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
