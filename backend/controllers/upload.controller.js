import { sendSuccess } from "../helpers/successResponse.js";
import { createHttpError } from "../helpers/httpError.js";

export const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError("Nenhuma imagem foi enviada", 400, undefined, "UPLOAD_FILE_MISSING");
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;

    return sendSuccess(res, 201, "Imagem enviada com sucesso", {
      imageUrl,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  } catch (error) {
    return next(error);
  }
};
