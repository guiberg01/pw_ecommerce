// definindo as funções de controle para as rotas de autenticação
import User from "../models/user.model.js";
import { createHttpError } from "../helpers/httpError.js";
import { sendSuccess } from "../helpers/successResponse.js";
import { endUserSession, rotateAccessToken, startUserSession } from "../services/auth.service.js";

export const signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });

    if (userExists) {
      throw createHttpError("Usuário já existe", 400, undefined, "AUTH_USER_ALREADY_EXISTS");
    }

    const user = await User.create({ name, email, password });

    await startUserSession(req, res, user._id);

    return sendSuccess(res, 201, "Cadastro realizado com sucesso", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    return next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      throw createHttpError("Credenciais inválidas", 401, undefined, "AUTH_INVALID_CREDENTIALS");
    }

    await startUserSession(req, res, user._id);

    return sendSuccess(res, 200, "Login realizado com sucesso", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    return next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    await endUserSession(req, res);
    return sendSuccess(res, 200, "Logout realizado com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    await rotateAccessToken(req, res);

    return sendSuccess(res, 200, "Token renovado com sucesso");
  } catch (error) {
    return next(error);
  }
};
