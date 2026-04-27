import { redis } from "../config/redis.js";
import crypto from "crypto";
import { createRedisUnavailableError } from "./redisError.helper.js";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACCESS_TOKEN_BLOCKLIST_PREFIX = "blocklist:access:";

const buildAccessTokenBlocklistKey = ({ token, jti }) => {
  if (jti) {
    return `${ACCESS_TOKEN_BLOCKLIST_PREFIX}jti:${jti}`;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return `${ACCESS_TOKEN_BLOCKLIST_PREFIX}token:${tokenHash}`;
};

export const setRefreshToken = async (userId, refreshToken) => {
  try {
    await redis.set(`refreshToken:${userId}`, refreshToken, "EX", REFRESH_TOKEN_TTL_SECONDS);
  } catch (error) {
    throw createRedisUnavailableError("Autenticação", "set-refresh-token", error);
  }
};

export const getRefreshToken = async (userId) => {
  try {
    return await redis.get(`refreshToken:${userId}`);
  } catch (error) {
    throw createRedisUnavailableError("Autenticação", "get-refresh-token", error);
  }
};

export const deleteRefreshToken = async (userId) => {
  try {
    await redis.del(`refreshToken:${userId}`);
  } catch (error) {
    throw createRedisUnavailableError("Autenticação", "delete-refresh-token", error);
  }
};

export const addAccessTokenToBlocklist = async ({ token, jti, expiresAt }) => {
  try {
    if (!token || !expiresAt) return;

    const ttlSeconds = Math.floor(expiresAt - Date.now() / 1000);

    if (ttlSeconds <= 0) return;

    const key = buildAccessTokenBlocklistKey({ token, jti });
    await redis.set(key, "1", "EX", ttlSeconds);
  } catch (error) {
    throw createRedisUnavailableError("Autenticação", "add-access-token-to-blocklist", error);
  }
};

export const isAccessTokenBlocklisted = async ({ token, jti }) => {
  try {
    if (!token) return false;

    const key = buildAccessTokenBlocklistKey({ token, jti });
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    throw createRedisUnavailableError("Autenticação", "is-access-token-blocklisted", error);
  }
};
