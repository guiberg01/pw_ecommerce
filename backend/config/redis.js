import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export const redis = new Redis(process.env.REDIS_URL);

redis.on("error", (error) => {
  console.error("[Redis] Erro de conexão:", error?.message ?? error);
});

export const disconnectRedis = async () => {
  if (redis.status === "end") return;
  await redis.quit();
};
