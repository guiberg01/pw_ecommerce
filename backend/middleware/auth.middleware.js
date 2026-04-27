import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { isAccessTokenBlocklisted } from "../helpers/redisAuth.helper.js";

const resolveUserFromAccessToken = async (accessToken) => {
  if (!accessToken) return null;

  const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN);
  return User.findById(decoded.userId).select("-password");
};

const ensureUserIsActiveOrThrow = (user) => {
  if (user?.status !== "active") {
    throw createHttpError("Usuário inválido ou inativo", 403, undefined, "AUTH_USER_INACTIVE");
  }
};

const isAuthTokenError = (error) => {
  return error?.name === "TokenExpiredError" || error?.name === "JsonWebTokenError";
};

export const isLoggedIn = async (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken;

    if (!accessToken) {
      throw createHttpError("Não autorizado - Token inválido ou ausente", 401, undefined, "AUTH_TOKEN_MISSING");
    }

    const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN);
    const isBlocklisted = await isAccessTokenBlocklisted({ token: accessToken, jti: decoded.jti });

    if (isBlocklisted) {
      throw createHttpError("Não autorizado - Sessão inválida", 401, undefined, "AUTH_TOKEN_REVOKED");
    }

    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      throw createHttpError("Não autorizado - Usuário não encontrado", 401, undefined, "AUTH_USER_NOT_FOUND");
    }

    ensureUserIsActiveOrThrow(user);

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
};

export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw createHttpError("Não autorizado - Usuário não encontrado", 401, undefined, "AUTH_USER_NOT_FOUND");
      }

      ensureUserIsActiveOrThrow(req.user);

      if (!allowedRoles.includes(req.user.role)) {
        throw createHttpError("Acesso proibido - Permissão insuficiente", 403, undefined, "AUTH_ROLE_FORBIDDEN");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const isAdmin = authorizeRoles("admin");
export const isSeller = authorizeRoles("seller");

export const optionalAuth = async (req, res, next) => {
  try {
    if (!req.cookies.accessToken) {
      return next();
    }

    const user = await resolveUserFromAccessToken(req.cookies.accessToken);

    if (user) {
      ensureUserIsActiveOrThrow(user);
      req.user = user;
    }

    return next();
  } catch (error) {
    if (isAuthTokenError(error) || ["AUTH_USER_NOT_FOUND", "AUTH_USER_INACTIVE"].includes(error?.code)) {
      return next();
    }

    return next(error);
  }
};
