import { redis } from "../config/redis.js";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const createRedisUnavailableError = (operation, originalError) => {
  const error = new Error(`Serviço de autenticação temporariamente indisponível (${operation})`);
  error.statusCode = 503;
  error.code = "REDIS_UNAVAILABLE";
  error.details = {
    operation,
    reason: originalError?.message,
  };
  return error;
};

export const setRefreshToken = async (userId, refreshToken) => {
  try {
    await redis.set(`refreshToken:${userId}`, refreshToken, "EX", REFRESH_TOKEN_TTL_SECONDS);
  } catch (error) {
    throw createRedisUnavailableError("set-refresh-token", error);
  }
};

export const getRefreshToken = async (userId) => {
  try {
    return await redis.get(`refreshToken:${userId}`);
  } catch (error) {
    throw createRedisUnavailableError("get-refresh-token", error);
  }
};

export const deleteRefreshToken = async (userId) => {
  try {
    await redis.del(`refreshToken:${userId}`);
  } catch (error) {
    throw createRedisUnavailableError("delete-refresh-token", error);
  }
};
