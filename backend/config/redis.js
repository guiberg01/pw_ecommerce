import Redis from "ioredis";
import dotenv from "dotenv";
import { createRedisUnavailableError } from "../helpers/redisError.helper.js";

dotenv.config();

export const redis = new Redis(process.env.REDIS_URL);

redis.on("error", (error) => {
  createRedisUnavailableError("Redis", "connection", error);
});

export const disconnectRedis = async () => {
  if (redis.status === "end") return;
  await redis.quit();
};
