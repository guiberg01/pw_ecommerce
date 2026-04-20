import { createHttpError } from "../helpers/httpError.js";
import { redis } from "../config/redis.js";

const clientBucketByKey = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_REDIS_KEY_PREFIX = "rate_limit";
const RATE_LIMIT_DEFAULT_STORE = "redis";

const RATE_LIMIT_WINDOW_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

const now = () => Date.now();

const cleanupHandle = setInterval(() => {
  const currentTime = now();

  for (const [key, bucket] of clientBucketByKey) {
    if (bucket.expiresAt <= currentTime) {
      clientBucketByKey.delete(key);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);

if (typeof cleanupHandle.unref === "function") {
  cleanupHandle.unref();
}

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
};

const shouldUseRedisStore = () => {
  const selectedStore = String(process.env.RATE_LIMIT_STORE ?? RATE_LIMIT_DEFAULT_STORE)
    .trim()
    .toLowerCase();

  return selectedStore === "redis";
};

const applyInMemoryRateLimit = ({ key, currentTime, windowMs, max, message, next }) => {
  const bucket = clientBucketByKey.get(key);
  if (!bucket || bucket.expiresAt <= currentTime) {
    clientBucketByKey.set(key, {
      count: 1,
      expiresAt: currentTime + windowMs,
    });

    return next();
  }

  if (bucket.count >= max) {
    return next(createHttpError(message, 429, { retryAfterMs: bucket.expiresAt - currentTime }, "RATE_LIMITED"));
  }

  bucket.count += 1;
  clientBucketByKey.set(key, bucket);
  return next();
};

const applyRedisRateLimit = async ({ key, windowMs, max, message, next }) => {
  const redisKey = `${RATE_LIMIT_REDIS_KEY_PREFIX}:${key}`;
  const [count, ttl] = await redis.eval(RATE_LIMIT_WINDOW_LUA, 1, redisKey, windowMs);

  if (Number(count) > max) {
    return next(
      createHttpError(
        message,
        429,
        {
          retryAfterMs: Math.max(0, Number(ttl) || 0),
        },
        "RATE_LIMITED",
      ),
    );
  }

  return next();
};

export const createRateLimit = ({
  windowMs,
  max,
  scope,
  message = "Muitas requisições. Tente novamente em instantes.",
}) => {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs deve ser um número positivo");
  }

  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("max deve ser um número positivo");
  }

  return async (req, res, next) => {
    const clientIp = getClientIp(req);
    const key = `${scope}:${clientIp}`;
    const currentTime = now();

    if (!shouldUseRedisStore()) {
      return applyInMemoryRateLimit({ key, currentTime, windowMs, max, message, next });
    }

    try {
      if (redis.status === "ready" || redis.status === "connect" || redis.status === "connecting") {
        return await applyRedisRateLimit({ key, windowMs, max, message, next });
      }
    } catch (error) {
      console.warn("[RateLimit] Fallback para memória após falha no Redis:", error?.message ?? error);
    }

    return applyInMemoryRateLimit({ key, currentTime, windowMs, max, message, next });
  };
};
