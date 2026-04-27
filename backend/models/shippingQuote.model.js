import mongoose from "mongoose";

/**
 * ShippingQuote salva a cotação de frete recebida da API MelhorEnvio
 * durante o checkout, para garantir consistência até a compra
 */
const shippingQuoteSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    subOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubOrder",
      required: true,
      index: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    // Resultado do cálculo ME API - salvo para referência
    quotaData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Array de opções de transportadora retornadas
    carriers: [
      {
        id: String, // serviceId do ME
        name: String,
        price: {
          type: Number,
        },
        customPrice: {
          type: Number,
        },
        deliveryTime: Number,
        customDeliveryTime: Number,
      },
    ],
    // Volumes/pacotes calculados pelo ME
    packages: [
      {
        price: {
          type: Number,
        },
        discount: {
          type: Number,
        },
        format: String,
        weight: Number,
        dimensions: {
          height: Number,
          width: Number,
          length: Number,
        },
        products: [
          {
            id: String,
            quantity: Number,
          },
        ],
      },
    ],
    // Transportadora selecionada
    selectedCarrier: {
      id: String,
      name: String,
      price: {
        type: Number,
      },
      deliveryTime: Number,
    },
    // Quem paga o frete
    whoPays: {
      type: String,
      enum: ["customer_pays", "platform_paid"],
      default: "customer_pays",
    },
    // Meta: quando aplica cupom de frete grátis
    freeShipping: {
      type: Boolean,
      default: false,
    },
    // Status: se foi convertido em ShippingLabel
    convertedToLabel: {
      type: Boolean,
      default: false,
    },
    shippingLabel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shipping",
      default: null,
    },
    // Validade: cotação expira em 7 dias por padrão (como no ME)
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

const ShippingQuote = mongoose.model("ShippingQuote", shippingQuoteSchema);

export default ShippingQuote;
