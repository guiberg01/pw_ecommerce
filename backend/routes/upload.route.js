import { Router } from "express";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { singleImageUpload } from "../config/upload.js";
import { uploadImage } from "../controllers/upload.controller.js";

const router = Router();

router.post("/images", isLoggedIn, singleImageUpload("image"), uploadImage);

export default router;
