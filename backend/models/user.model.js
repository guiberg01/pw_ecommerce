import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { accountStatuses } from "../constants/accountStatuses.js";
import { useSoftDelete } from "./plugins/softDelete.plugin.js";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "O nome é obrigatório"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "O email é obrigatório"],
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "A senha é obrigatória"],
      minlength: [6, "A senha deve ter pelo menos 6 caracteres"],
    },
    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },
    cpf: {
      type: String,
      default: null,
      trim: true,
      set: (value) => {
        if (value == null) return null;
        const normalized = String(value).trim();
        return normalized.length === 0 ? null : normalized;
      },
    },
    stripeCustomerId: {
      type: String,
      default: null,
      trim: true,
    },
    telephone: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(accountStatuses),
      default: accountStatuses.ACTIVE,
      index: true,
    },
    suspendedSince: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ cpf: 1 }, { unique: true, sparse: true });

userSchema.virtual("review", {
  ref: "Review",
  localField: "_id",
  foreignField: "user",
});

userSchema.virtual("paymentMethod", {
  ref: "PaymentMethod",
  localField: "_id",
  foreignField: "user",
});

userSchema.virtual("address", {
  ref: "Address",
  localField: "_id",
  foreignField: "user",
});

userSchema.virtual("order", {
  ref: "Order",
  localField: "_id",
  foreignField: "user",
});

useSoftDelete(userSchema);

const User = mongoose.model("User", userSchema);

export default User;
