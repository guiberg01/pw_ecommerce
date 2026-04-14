import { redis } from "../config/redis.js";
import { createRedisUnavailableError } from "./redisError.helper.js";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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
