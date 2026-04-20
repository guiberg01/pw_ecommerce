import jwt from "jsonwebtoken";
import { clearGuestCartCookie, syncGuestCartToUserCart } from "../helpers/cart.helper.js";
import { deleteRefreshToken, getRefreshToken, setRefreshToken } from "../helpers/redisAuth.helper.js";
import { createHttpError } from "../helpers/httpError.js";

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

export const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.ACCESS_TOKEN, {
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
};

export const endUserSession = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN);
      await deleteRefreshToken(decoded.userId);
    } catch (error) {
      console.log("Erro ao invalidar refresh token durante logout:", error?.message ?? error);
    }
  }

  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
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

  const accessToken = jwt.sign({ userId: decoded.userId }, process.env.ACCESS_TOKEN, {
    expiresIn: "15m",
  });

  setAuthCookie(res, "accessToken", accessToken, ACCESS_COOKIE_AGE_MS);
};
