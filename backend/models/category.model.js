import mongoose from "mongoose";
import { slugify } from "../helpers/slugUnique.helper.js";
import { useSoftDelete } from "./plugins/softDelete.plugin.js";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "O nome da categoria é obrigatório"],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true },
);

categorySchema.pre("validate", function () {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
});

useSoftDelete(categorySchema);

categorySchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  },
);

const Category = mongoose.model("Category", categorySchema);

export default Category;
