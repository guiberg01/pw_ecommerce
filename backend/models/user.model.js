import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// definindo o schema do usuário, com os campos necessários e suas validações bem completinho
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "O nome é obrigatório"],
    },
    email: {
      type: String,
      required: [true, "O email é obrigatório"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "A senha é obrigatória"],
      minlength: [6, "A senha deve ter pelo menos 6 caracteres"],
    },
    cart: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        quantity: {
          type: Number,
          default: 1,
        },
      },
    ],
    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },
  },
  {
    timestamps: true,
  },
);

// Antes de salvar o usuário no banco, ele roda o código de baixo e faz o hash na senha se ela tiver sido modificada
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, 10);
});

// Compara a senha fornecida com a do banco
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// criando o modelo do usuário a partir do schema
const User = mongoose.model("User", userSchema);

export default User;
