// definindo as funções de controle para as rotas de autenticação
import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import { sendSuccess } from "../helpers/successResponse.js";
import { deleteRefreshToken, getRefreshToken, setRefreshToken } from "../helpers/redisAuth.helper.js";

//criando os tokens
const generateToken = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.ACCESS_TOKEN, {
    expiresIn: "15m",
  });

  const refreshToken = jwt.sign({ userId }, process.env.REFRESH_TOKEN, {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

//função para setar os cookies dinamicamente
function setAuthCookie(res, name, value, maxAge) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: maxAge,
  });
}

//setando os cookies
const setCookies = (res, accessToken, refreshToken) => {
  setAuthCookie(res, "accessToken", accessToken, 15 * 60 * 1000); // 15 minutos
  setAuthCookie(res, "refreshToken", refreshToken, 7 * 24 * 60 * 60 * 1000); // 7 dias
};

export const signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const userExists = await User.findOne({ email });

    if (userExists) {
      const error = new Error("Usuário já existe");
      error.statusCode = 400;
      throw error;
    }

    const user = await User.create({ name, email, password });

    const { accessToken, refreshToken } = generateToken(user._id);
    await setRefreshToken(user._id, refreshToken);

    setCookies(res, accessToken, refreshToken);

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
      const error = new Error("Credenciais inválidas");
      error.statusCode = 401;
      throw error;
    }

    const { accessToken, refreshToken } = generateToken(user._id);
    await setRefreshToken(user._id, refreshToken);

    setCookies(res, accessToken, refreshToken);

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
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
      await deleteRefreshToken(decoded.userId);
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return sendSuccess(res, 200, "Logout realizado com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      const error = new Error("Refresh token ausente");
      error.statusCode = 401;
      throw error;
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
    const storedToken = await getRefreshToken(decoded.userId);

    if (storedToken !== refreshToken) {
      const error = new Error("Refresh token inválido");
      error.statusCode = 403;
      throw error;
    }

    const accessToken = jwt.sign({ userId: decoded.userId }, process.env.ACCESS_TOKEN, {
      expiresIn: "15m",
    });

    setAuthCookie(res, "accessToken", accessToken, 15 * 60 * 1000);

    return sendSuccess(res, 200, "Token renovado com sucesso");
  } catch (error) {
    return next(error);
  }
};
