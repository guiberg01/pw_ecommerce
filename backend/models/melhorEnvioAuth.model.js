import mongoose from "mongoose";

/**
 * Armazena autenticação OAuth2 com MelhorEnvio por seller
 * Um seller (store owner) pode ter apenas 1 registro ativo
 */
const melhorEnvioAuthSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
      trim: true,
    },
    refreshToken: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastRefreshed: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

const MelhorEnvioAuth = mongoose.model("MelhorEnvioAuth", melhorEnvioAuthSchema);

export default MelhorEnvioAuth;
