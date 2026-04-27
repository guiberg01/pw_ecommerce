import { sendSuccess } from "../helpers/successResponse.js";
import { createHttpError } from "../helpers/httpError.js";
import SubOrder from "../models/subOrder.model.js";
import Order from "../models/order.model.js";

const UPLOAD_ACCESS_BY_CONTEXT = {
  product: new Set(["seller", "admin"]),
  "store-logo": new Set(["seller", "admin"]),
  review: new Set(["customer", "admin"]),
  profile: new Set(["customer", "seller", "admin"]),
  banner: new Set(["admin"]),
  chat: new Set(["customer", "seller", "admin"]),
};

const resolveUploadContext = (req) => req.params.context;

const resolvePublicBaseUrl = (req) => {
  const explicitBaseUrl = String(process.env.PUBLIC_BASE_URL ?? "").trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  const forwardedProtoHeader = req.get("x-forwarded-proto");
  const forwardedProto = String(forwardedProtoHeader ?? "").split(",")[0].trim();
  const protocol = forwardedProto || (req.secure ? "https" : req.protocol);
  const host = req.get("x-forwarded-host") || req.get("host");

  return `${protocol}://${host}`;
};

const validateUploadContextOrThrow = (context) => {
  if (!UPLOAD_ACCESS_BY_CONTEXT[context]) {
    throw createHttpError("Contexto de upload inválido", 400, undefined, "UPLOAD_CONTEXT_INVALID");
  }
};

const validateRoleForContextOrThrow = (context, role) => {
  const allowedRoles = UPLOAD_ACCESS_BY_CONTEXT[context];

  if (!allowedRoles?.has(role)) {
    throw createHttpError(
      "Acesso proibido - Permissão insuficiente para este tipo de upload",
      403,
      { context, allowedRoles: [...(allowedRoles ?? [])] },
      "UPLOAD_CONTEXT_FORBIDDEN",
    );
  }
};

const ensureReviewUploadEligibilityForCustomerOrThrow = async (subOrderId, userId) => {
  if (!subOrderId) {
    throw createHttpError("subOrderId é obrigatório para upload de review", 400, undefined, "UPLOAD_REVIEW_SUBORDER_REQUIRED");
  }

  const subOrder = await SubOrder.findOne({ _id: subOrderId, status: "delivered" }).select("_id order status").lean();

  if (!subOrder) {
    throw createHttpError(
      "Subpedido não encontrado ou ainda não entregue",
      403,
      undefined,
      "UPLOAD_REVIEW_SUBORDER_NOT_DELIVERED",
    );
  }

  const order = await Order.findById(subOrder.order).select("_id user").lean();

  if (!order || order.user?.toString() !== userId.toString()) {
    throw createHttpError(
      "Acesso proibido - O subpedido não pertence ao usuário",
      403,
      undefined,
      "UPLOAD_REVIEW_SUBORDER_FORBIDDEN",
    );
  }
};

const ensureContextSpecificRulesOrThrow = async (req) => {
  const context = resolveUploadContext(req);

  if (context === "review" && req.user.role === "customer") {
    await ensureReviewUploadEligibilityForCustomerOrThrow(req.body.subOrderId, req.user._id);
  }
};

export const authorizeUploadByContext = async (req, res, next) => {
  try {
    const context = resolveUploadContext(req);
    validateUploadContextOrThrow(context);
    validateRoleForContextOrThrow(context, req.user.role);
    await ensureContextSpecificRulesOrThrow(req);

    return next();
  } catch (error) {
    return next(error);
  }
};

export const uploadImageByContext = async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError("Nenhuma imagem foi enviada", 400, undefined, "UPLOAD_FILE_MISSING");
    }

    const context = resolveUploadContext(req);
    const baseUrl = resolvePublicBaseUrl(req);
    const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;

    return sendSuccess(res, 201, "Imagem enviada com sucesso", {
      context,
      imageUrl,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  } catch (error) {
    return next(error);
  }
};
