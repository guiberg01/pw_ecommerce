import { Router } from "express";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { singleImageUpload } from "../config/upload.js";
import { authorizeUploadByContext, uploadImageByContext } from "../controllers/upload.controller.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { uploadContextParamSchema, uploadImageBodySchema } from "../validators/upload.validator.js";

const router = Router();

router.post(
	"/images/:context",
	isLoggedIn,
	validateParams(uploadContextParamSchema),
	singleImageUpload("image"),
	validateBody(uploadImageBodySchema),
	authorizeUploadByContext,
	uploadImageByContext,
);

export default router;
