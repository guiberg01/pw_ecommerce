import { randomUUID } from "crypto";
import { redis } from "../config/redis.js";

const releaseLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const acquireRedisLock = async ({ key, ttlMs }) => {
  const token = randomUUID();
  const result = await redis.set(key, token, "PX", ttlMs, "NX");

  if (result !== "OK") {
    return null;
  }

  return token;
};

export const releaseRedisLock = async ({ key, token }) => {
  if (!token) return;

  await redis.eval(releaseLockScript, 1, key, token);
};

export const waitAndAcquireRedisLock = async ({ key, ttlMs, waitTimeoutMs = 8000, retryDelayMs = 120 }) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < waitTimeoutMs) {
    const token = await acquireRedisLock({ key, ttlMs });

    if (token) {
      return token;
    }

    await sleep(retryDelayMs);
  }

  return null;
};
