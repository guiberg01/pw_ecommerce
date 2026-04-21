import mongoose from "mongoose";

const ticketMessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: ["customer", "seller", "admin"],
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    moderated: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

const ticketSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    subOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubOrder",
      default: null,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    blockedRole: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: null,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    unreadCountCustomer: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCountSeller: {
      type: Number,
      default: 0,
      min: 0,
    },
    messages: {
      type: [ticketMessageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

ticketSchema.index({ user: 1, store: 1 }, { unique: true, partialFilterExpression: { store: { $ne: null } } });
ticketSchema.index({ store: 1, updatedAt: -1 });
ticketSchema.index({ user: 1, updatedAt: -1 });

const Ticket = mongoose.model("Ticket", ticketSchema);

export default Ticket;
