import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const isLoggedIn = async (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken;

    if (!accessToken) {
      const error = new Error("Não autorizado - Token inválido ou ausente");
      error.statusCode = 401;
      throw error;
    }

    const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN);
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      const error = new Error("Não autorizado - Usuário não encontrado");
      error.statusCode = 401;
      throw error;
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
        const error = new Error("Não autorizado - Usuário não encontrado");
        error.statusCode = 401;
        throw error;
      }

      if (!allowedRoles.includes(req.user.role)) {
        const error = new Error("Acesso proibido - Permissão insuficiente");
        error.statusCode = 403;
        throw error;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const isAdmin = authorizeRoles("admin");
export const isSeller = authorizeRoles("seller");
