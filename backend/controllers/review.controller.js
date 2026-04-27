import { sendSuccess } from "../helpers/successResponse.js";
import {
  createReviewForUser,
  deleteOwnReview,
  deleteReviewReply,
  getAdminReviews,
  getMyReviews,
  listProductReviews,
  listStoreProductReviews,
  updateOwnReview,
  upsertReviewReply,
} from "../services/review.service.js";

export const getProductReviews = async (req, res, next) => {
    const result = await listProductReviews(req.params.productId, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Reviews do produto carregadas com sucesso", result);
};

export const getMyReviewList = async (req, res, next) => {
    const result = await getMyReviews(req.user._id, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Suas reviews foram carregadas com sucesso", result);
};

export const postReview = async (req, res, next) => {
    const review = await createReviewForUser(req.user, req.body);
    return sendSuccess(res, 201, "Review criada com sucesso", review);
};

export const patchMyReview = async (req, res, next) => {
    const review = await updateOwnReview(req.user, req.params.id, req.body);
    return sendSuccess(res, 200, "Review atualizada com sucesso", review);
};

export const removeMyReview = async (req, res, next) => {
    await deleteOwnReview(req.user, req.params.id);
    return sendSuccess(res, 200, "Review removida com sucesso", null);
};

export const getStoreReviewList = async (req, res, next) => {
    const result = await listStoreProductReviews(req.user, req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Reviews dos produtos da loja carregadas com sucesso", result);
};

export const putReviewReply = async (req, res, next) => {
    const review = await upsertReviewReply(req.user, req.params.id, req.body.comment);
    return sendSuccess(res, 200, "Resposta da loja salva com sucesso", review);
};

export const removeReviewReply = async (req, res, next) => {
    const review = await deleteReviewReply(req.user, req.params.id);
    return sendSuccess(res, 200, "Resposta da loja removida com sucesso", review);
};

export const getAdminReviewList = async (req, res, next) => {
    const result = await getAdminReviews(req.validatedQuery ?? {});
    return sendSuccess(res, 200, "Reviews globais carregadas com sucesso", result);
};
