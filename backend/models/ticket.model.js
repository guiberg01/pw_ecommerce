import mongoose from "mongoose";
import crypto from "crypto";

const TICKET_CHANNELS = ["direct_message", "platform_support"];
const TICKET_STATUSES = [
  "open",
  "triage",
  "in_progress",
  "waiting_requester",
  "waiting_internal",
  "resolved",
  "reopened",
  "closed",
];

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
      default: "",
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
    channel: {
      type: String,
      enum: TICKET_CHANNELS,
      default: "direct_message",
      index: true,
    },
    ticketNumber: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    requesterType: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: null,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    category: {
      type: String,
      enum: ["technical", "order", "store", "refund", "delivery", "payment", "account", "other"],
      default: null,
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
      enum: TICKET_STATUSES,
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
    unreadCountRequester: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCountPlatform: {
      type: Number,
      default: 0,
      min: 0,
    },
    resolutionSummary: {
      type: String,
      default: null,
      trim: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    messages: {
      type: [ticketMessageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

ticketSchema.pre("validate", function () {
  if (this.channel === "platform_support") {
    if (!this.requester) {
      this.requester = this.user;
    }

    if (!this.ticketNumber) {
      const year = new Date().getFullYear();
      const suffix = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      this.ticketNumber = `TK-${year}-${suffix}`;
    }
  }
});

ticketSchema.index(
  { channel: 1, user: 1, store: 1 },
  {
    unique: true,
    partialFilterExpression: {
      channel: "direct_message",
      store: { $ne: null },
    },
  },
);
ticketSchema.index(
  { channel: 1, ticketNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      channel: "platform_support",
      ticketNumber: { $type: "string" },
    },
  },
);
ticketSchema.index({ store: 1, updatedAt: -1 });
ticketSchema.index({ user: 1, updatedAt: -1 });
ticketSchema.index({ channel: 1, requester: 1, updatedAt: -1 });

const Ticket = mongoose.model("Ticket", ticketSchema);

export default Ticket;
