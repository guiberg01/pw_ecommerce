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
    price: {
      type: Number,
      required: [true, "O preço do produto é obrigatório"],
      min: [0, "O preço do produto deve ser um valor positivo"],
    },
    imageUrl: {
      type: String,
      required: [true, "A URL da imagem do produto é obrigatória"],
    },
    category: {
      type: String,
      required: [true, "A categoria do produto é obrigatória"],
    },
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
      required: [true, "A quantidade em estoque do produto é obrigatória"],
      min: [0, "A quantidade em estoque do produto não pode ser negativa"],
    },
    status: {
      type: String,
      enum: ["available", "blocked", "deleted", "unavailable", "cancelled"],
      default: "available",
    },
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", productSchema);

export default Product;
