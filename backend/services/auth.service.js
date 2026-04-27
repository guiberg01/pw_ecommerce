import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { clearGuestCartCookie, syncGuestCartToUserCart } from "../helpers/cart.helper.js";
import {
  addAccessTokenToBlocklist,
  deleteRefreshToken,
  getRefreshToken,
  setRefreshToken,
} from "../helpers/redisAuth.helper.js";
import { createHttpError } from "../helpers/httpError.js";
import { accountStatuses } from "../constants/accountStatuses.js";
import User from "../models/user.model.js";

const ACCESS_COOKIE_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const setAuthCookie = (res, name, value, maxAge) => {
  res.cookie(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge,
  });
};

const clearAuthCookie = (res, name) => {
  res.clearCookie(name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
};

export const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId, jti: randomUUID() }, process.env.ACCESS_TOKEN, {
    expiresIn: "15m",
  });

  const refreshToken = jwt.sign({ userId }, process.env.REFRESH_TOKEN, {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

export const setSessionCookies = (res, accessToken, refreshToken) => {
  setAuthCookie(res, "accessToken", accessToken, ACCESS_COOKIE_AGE_MS);
  setAuthCookie(res, "refreshToken", refreshToken, REFRESH_COOKIE_AGE_MS);
};

export const startUserSession = async (req, res, userId) => {
  const { accessToken, refreshToken } = generateTokens(userId);
  await setRefreshToken(userId, refreshToken);
  await syncGuestCartToUserCart(userId, req.cookies.guestCartId);
  clearGuestCartCookie(res);
  setSessionCookies(res, accessToken, refreshToken);

  return { accessToken, refreshToken };
};

export const endUserSession = async (req, res) => {
  const accessToken = req.cookies.accessToken;
  const refreshToken = req.cookies.refreshToken;

  if (accessToken) {
    try {
      const decodedAccessToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN);
      await addAccessTokenToBlocklist({
        token: accessToken,
        jti: decodedAccessToken.jti,
        expiresAt: decodedAccessToken.exp,
      });
    } catch (error) {
      // Access token já expirado ou inválido não precisa ser bloqueado.
    }
  }

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
      await deleteRefreshToken(decoded.userId);
    } catch (error) {
      console.log("Erro ao invalidar refresh token durante logout:", error?.message ?? error);
    }
  }

  clearAuthCookie(res, "accessToken");
  clearAuthCookie(res, "refreshToken");
  clearGuestCartCookie(res);
};

export const rotateAccessToken = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    throw createHttpError("Refresh token ausente", 401, undefined, "AUTH_REFRESH_TOKEN_MISSING");
  }

  const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
  const storedToken = await getRefreshToken(decoded.userId);

  if (storedToken !== refreshToken) {
    throw createHttpError("Refresh token inválido", 403, undefined, "AUTH_REFRESH_TOKEN_INVALID");
  }

  const user = await User.findById(decoded.userId).select("_id status");

  if (!user || user.status !== accountStatuses.ACTIVE) {
    await deleteRefreshToken(decoded.userId);
    throw createHttpError("Usuário inválido ou inativo", 403, undefined, "AUTH_USER_INACTIVE");
  }

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);
  await setRefreshToken(decoded.userId, newRefreshToken);
  setSessionCookies(res, accessToken, newRefreshToken);
};
