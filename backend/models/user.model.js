import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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
      enum: ["active", "suspended", "deleted", "blocked", "pending"],
      default: "active",
      index: true,
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

userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: "deleted" } },
  },
);

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

const User = mongoose.model("User", userSchema);

export default User;
