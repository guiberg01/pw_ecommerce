import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import multer from "multer";
import { createHttpError } from "../helpers/httpError.js";

const UPLOADS_RELATIVE_PATH = path.join(os.tmpdir(), "uploads");
const MAX_IMAGE_SIZE_MB = Number(process.env.UPLOAD_MAX_IMAGE_MB ?? 5);
const MAX_IMAGE_SIZE_BYTES = Math.max(1, MAX_IMAGE_SIZE_MB) * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const getUploadDirectoryPath = () => UPLOADS_RELATIVE_PATH;

export const ensureUploadDirectoryExists = async () => {
  await fs.mkdir(getUploadDirectoryPath(), { recursive: true });
};

const imageStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, getUploadDirectoryPath());
  },
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const randomName = crypto.randomUUID();
    callback(null, `${Date.now()}-${randomName}${extension}`);
  },
});

const imageFileFilter = (req, file, callback) => {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    callback(createHttpError("Formato de imagem não suportado", 400, { allowed: [...ALLOWED_IMAGE_MIME_TYPES] }, "UPLOAD_INVALID_IMAGE_TYPE"));
    return;
  }

  callback(null, true);
};

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
  },
});

export const singleImageUpload = (fieldName = "image") => {
  const middleware = imageUpload.single(fieldName);

  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error?.name === "MulterError" && error?.code === "LIMIT_FILE_SIZE") {
        return next(
          createHttpError(
            `A imagem excede o limite de ${MAX_IMAGE_SIZE_MB}MB`,
            400,
            { maxSizeMb: MAX_IMAGE_SIZE_MB },
            "UPLOAD_FILE_TOO_LARGE",
          ),
        );
      }

      return next(error);
    });
  };
};
