import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { createHttpError } from "../helpers/httpError.js";

const resolveUserFromAccessToken = async (accessToken) => {
  if (!accessToken) return null;

  const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN);
  return User.findById(decoded.userId).select("-password");
};

export const isLoggedIn = async (req, res, next) => {
  try {
    if (!req.cookies.accessToken) {
      throw createHttpError("Não autorizado - Token inválido ou ausente", 401, undefined, "AUTH_TOKEN_MISSING");
    }

    const user = await resolveUserFromAccessToken(req.cookies.accessToken);

    if (!user) {
      throw createHttpError("Não autorizado - Usuário não encontrado", 401, undefined, "AUTH_USER_NOT_FOUND");
    }

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
      req.user = user;
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
