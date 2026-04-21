import { Router } from "express";
import {
  getAdminReviewList,
  getMyReviewList,
  getProductReviews,
  getStoreReviewList,
  patchMyReview,
  postReview,
  putReviewReply,
  removeMyReview,
  removeReviewReply,
} from "../controllers/review.controller.js";
import { isAdmin, isLoggedIn, isSeller } from "../middleware/auth.middleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.middleware.js";
import {
  createReviewSchema,
  productReviewListQuerySchema,
  productReviewParamSchema,
  reviewIdParamSchema,
  updateReviewSchema,
  upsertSellerReplySchema,
} from "../validators/review.validator.js";

const router = Router();

router.get(
  "/products/:productId",
  validateParams(productReviewParamSchema),
  validateQuery(productReviewListQuerySchema),
  getProductReviews,
);

router.get("/me", isLoggedIn, validateQuery(productReviewListQuerySchema), getMyReviewList);
router.post("/", isLoggedIn, validateBody(createReviewSchema), postReview);
router.patch("/:id", isLoggedIn, validateParams(reviewIdParamSchema), validateBody(updateReviewSchema), patchMyReview);
router.delete("/:id", isLoggedIn, validateParams(reviewIdParamSchema), removeMyReview);

router.get("/stores/me", isLoggedIn, isSeller, validateQuery(productReviewListQuerySchema), getStoreReviewList);
router.put(
  "/:id/reply",
  isLoggedIn,
  isSeller,
  validateParams(reviewIdParamSchema),
  validateBody(upsertSellerReplySchema),
  putReviewReply,
);
router.delete("/:id/reply", isLoggedIn, isSeller, validateParams(reviewIdParamSchema), removeReviewReply);

router.get("/admin", isLoggedIn, isAdmin, validateQuery(productReviewListQuerySchema), getAdminReviewList);

export default router;
