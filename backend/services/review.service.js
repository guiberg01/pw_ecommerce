import mongoose from "mongoose";
import Review from "../models/review.model.js";
import Product from "../models/product.model.js";
import SubOrder from "../models/subOrder.model.js";
import Order from "../models/order.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { findActiveStoreByOwnerOrThrow } from "./catalog.service.js";
import { notifyReviewCreatedForSeller, notifyReviewReplyForCustomer } from "./notification.service.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const normalizePagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limit)))
    : DEFAULT_LIMIT;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
};

const buildPaginationResult = ({ items, total, page, limit }) => ({
  items,
  meta: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / Math.max(limit, 1)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  },
});

const getSort = (sort) => {
  if (sort === "oldest") return { createdAt: 1 };
  if (sort === "highest") return { rating: -1, createdAt: -1 };
  if (sort === "lowest") return { rating: 1, createdAt: -1 };
  return { createdAt: -1 };
};

const syncProductRating = async (productId, session) => {
  const [ratingData] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: "$product",
        count: { $sum: 1 },
        sum: { $sum: "$rating" },
      },
    },
  ]).session(session);

  const ratingCount = Number(ratingData?.count ?? 0);
  const ratingSum = Number(ratingData?.sum ?? 0);

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        "rating.ratingCount": ratingCount,
        "rating.ratingSum": ratingSum,
      },
    },
    { session },
  );
};

const serializeReview = (review) => ({
  _id: review._id,
  product: review.product,
  user: review.user,
  subOrder: review.subOrder,
  rating: review.rating,
  comment: review.comment,
  images: review.images ?? [],
  videos: review.videos ?? [],
  sellerReply: review.sellerReply ?? { comment: null, repliedAt: null, editedAt: null },
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});

const ensureReviewOwnershipOrAdmin = (review, actor) => {
  if (actor.role === "admin") return;

  if (review.user.toString() !== actor._id.toString()) {
    throw createHttpError("Acesso proibido", 403, undefined, "REVIEW_FORBIDDEN");
  }
};

const ensureSellerCanReplyOrThrow = async (review, actor) => {
  if (actor.role === "admin") return;

  if (actor.role !== "seller") {
    throw createHttpError("Acesso proibido", 403, undefined, "REVIEW_REPLY_FORBIDDEN");
  }

  const store = await findActiveStoreByOwnerOrThrow(actor._id);
  const product = await Product.findById(review.product).select("store").lean();

  if (!product || product.store?.toString() !== store._id.toString()) {
    throw createHttpError("Acesso proibido", 403, undefined, "REVIEW_REPLY_FORBIDDEN");
  }
};

const ensureReviewEligibilityOrThrow = async ({ userId, productId, subOrderId, session }) => {
  const subOrder = await SubOrder.findOne({ _id: subOrderId, status: "delivered" })
    .select("_id order items")
    .session(session)
    .lean();

  if (!subOrder) {
    throw createHttpError("Subpedido não encontrado ou não entregue", 400, undefined, "REVIEW_SUBORDER_NOT_DELIVERED");
  }

  const order = await Order.findById(subOrder.order).select("_id user").session(session).lean();

  if (!order || order.user?.toString() !== userId.toString()) {
    throw createHttpError("Subpedido não pertence ao usuário", 403, undefined, "REVIEW_SUBORDER_FORBIDDEN");
  }

  const productVariantIds = new Set(subOrder.items.map((item) => item.productVariantId.toString()));
  const hasProduct = await Product.exists({
    _id: productId,
    status: { $ne: "deleted" },
    "productVariants._id": { $in: [...productVariantIds] },
  });

  if (!hasProduct) {
    const subOrderWithVariants = await SubOrder.findById(subOrderId)
      .populate({ path: "items.productVariantId", select: "product" })
      .session(session)
      .lean();

    const match = (subOrderWithVariants?.items ?? []).some(
      (item) => item.productVariantId?.product?.toString() === productId.toString(),
    );

    if (!match) {
      throw createHttpError(
        "O produto informado não pertence ao subpedido entregue",
        400,
        undefined,
        "REVIEW_PRODUCT_NOT_IN_SUBORDER",
      );
    }
  }
};

export const listProductReviews = async (productId, query = {}) => {
  const { page, limit, skip } = normalizePagination(query);
  const sort = getSort(query.sort);

  const [items, total, ratingSummary] = await Promise.all([
    Review.find({ product: productId }).sort(sort).skip(skip).limit(limit).populate("user", "name").lean(),
    Review.countDocuments({ product: productId }),
    Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(productId) } },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
          average: { $avg: "$rating" },
        },
      },
    ]),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of ratingSummary) {
    breakdown[row._id] = row.count;
  }

  const average = total
    ? Object.entries(breakdown).reduce((sum, [star, count]) => sum + Number(star) * Number(count), 0) / total
    : 0;

  return {
    ...buildPaginationResult({ items: items.map(serializeReview), total, page, limit }),
    summary: {
      average: Math.round(average * 100) / 100,
      total,
      breakdown,
    },
  };
};

export const getMyReviews = async (userId, query = {}) => {
  const { page, limit, skip } = normalizePagination(query);
  const sort = getSort(query.sort);

  const [items, total] = await Promise.all([
    Review.find({ user: userId })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("product", "name mainImageUrl store")
      .lean(),
    Review.countDocuments({ user: userId }),
  ]);

  return buildPaginationResult({ items: items.map(serializeReview), total, page, limit });
};

export const createReviewForUser = async (actor, payload) => {
  if (actor.role !== "customer" && actor.role !== "admin") {
    throw createHttpError("Acesso proibido", 403, undefined, "REVIEW_CREATE_FORBIDDEN");
  }

  const session = await mongoose.startSession();

  try {
    let createdReview;
    await session.withTransaction(async () => {
      await ensureReviewEligibilityOrThrow({
        userId: actor._id,
        productId: payload.productId,
        subOrderId: payload.subOrderId,
        session,
      });

      const existing = await Review.findOne({
        user: actor._id,
        product: payload.productId,
        subOrder: payload.subOrderId,
      })
        .session(session)
        .lean();

      if (existing) {
        throw createHttpError("Review já cadastrada para este pedido", 409, undefined, "REVIEW_ALREADY_EXISTS");
      }

      const [review] = await Review.create(
        [
          {
            product: payload.productId,
            user: actor._id,
            subOrder: payload.subOrderId,
            rating: payload.rating,
            comment: payload.comment ?? "",
            images: payload.images ?? [],
            videos: payload.videos ?? [],
          },
        ],
        { session },
      );

      await syncProductRating(payload.productId, session);
      createdReview = review;
    });

    const serialized = serializeReview(createdReview.toObject());

    await notifyReviewCreatedForSeller({
      productId: payload.productId,
      reviewId: serialized._id,
      rating: serialized.rating,
    });

    return serialized;
  } finally {
    await session.endSession();
  }
};

export const updateOwnReview = async (actor, reviewId, payload) => {
  const session = await mongoose.startSession();

  try {
    let updated;
    await session.withTransaction(async () => {
      const review = await Review.findById(reviewId).session(session);
      if (!review) {
        throw createHttpError("Review não encontrada", 404, undefined, "REVIEW_NOT_FOUND");
      }

      ensureReviewOwnershipOrAdmin(review, actor);

      if (payload.rating !== undefined) review.rating = payload.rating;
      if (payload.comment !== undefined) review.comment = payload.comment;
      if (payload.images !== undefined) review.images = payload.images;
      if (payload.videos !== undefined) review.videos = payload.videos;

      await review.save({ session });
      await syncProductRating(review.product, session);
      updated = review;
    });

    return serializeReview(updated.toObject());
  } finally {
    await session.endSession();
  }
};

export const deleteOwnReview = async (actor, reviewId) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const review = await Review.findById(reviewId).session(session);
      if (!review) {
        throw createHttpError("Review não encontrada", 404, undefined, "REVIEW_NOT_FOUND");
      }

      ensureReviewOwnershipOrAdmin(review, actor);
      const productId = review.product;
      await review.deleteOne({ session });
      await syncProductRating(productId, session);
    });
  } finally {
    await session.endSession();
  }
};

export const listStoreProductReviews = async (actor, query = {}) => {
  const store = await findActiveStoreByOwnerOrThrow(actor._id);

  const { page, limit, skip } = normalizePagination(query);
  const sort = getSort(query.sort);

  const productIds = await Product.find({ store: store._id, status: { $ne: "deleted" } }).distinct("_id");

  const [items, total] = await Promise.all([
    Review.find({ product: { $in: productIds } })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("product", "name")
      .populate("user", "name")
      .lean(),
    Review.countDocuments({ product: { $in: productIds } }),
  ]);

  return buildPaginationResult({ items: items.map(serializeReview), total, page, limit });
};

export const upsertReviewReply = async (actor, reviewId, comment) => {
  const review = await Review.findById(reviewId);

  if (!review) {
    throw createHttpError("Review não encontrada", 404, undefined, "REVIEW_NOT_FOUND");
  }

  await ensureSellerCanReplyOrThrow(review, actor);

  review.sellerReply = {
    comment,
    repliedAt: review.sellerReply?.repliedAt ?? new Date(),
    editedAt: review.sellerReply?.comment ? new Date() : null,
  };

  await review.save();
  await notifyReviewReplyForCustomer({
    userId: review.user,
    reviewId: review._id,
    productId: review.product,
  });

  return serializeReview(review.toObject());
};

export const deleteReviewReply = async (actor, reviewId) => {
  const review = await Review.findById(reviewId);

  if (!review) {
    throw createHttpError("Review não encontrada", 404, undefined, "REVIEW_NOT_FOUND");
  }

  await ensureSellerCanReplyOrThrow(review, actor);

  review.sellerReply = {
    comment: null,
    repliedAt: null,
    editedAt: null,
  };

  await review.save();
  return serializeReview(review.toObject());
};

export const getAdminReviews = async (query = {}) => {
  const { page, limit, skip } = normalizePagination(query);
  const sort = getSort(query.sort);

  const [items, total] = await Promise.all([
    Review.find({})
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("product", "name")
      .populate("user", "name email role")
      .lean(),
    Review.countDocuments({}),
  ]);

  return buildPaginationResult({ items: items.map(serializeReview), total, page, limit });
};
