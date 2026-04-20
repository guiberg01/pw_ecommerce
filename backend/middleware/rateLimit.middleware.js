import { createHttpError } from "../helpers/httpError.js";
import { redis } from "../config/redis.js";

const clientBucketByKey = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_REDIS_KEY_PREFIX = "rate_limit";
const RATE_LIMIT_DEFAULT_STORE = "redis";
const RATE_LIMIT_DEFAULT_FAIL_MODE = "memory";
const RATE_LIMIT_REDIS_LOG_COOLDOWN_MS = 30_000;

let lastRedisFallbackLogAt = 0;

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
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const getClientIdentity = (req) => {
  const userId = req.user?._id?.toString?.();

  if (typeof userId === "string" && userId.trim()) {
    return `user:${userId}`;
  }

  return `ip:${getClientIp(req)}`;
};

const shouldUseRedisStore = () => {
  const selectedStore = String(process.env.RATE_LIMIT_STORE ?? RATE_LIMIT_DEFAULT_STORE)
    .trim()
    .toLowerCase();

  return selectedStore === "redis";
};

const getFailMode = () => {
  const selectedFailMode = String(process.env.RATE_LIMIT_FAIL_MODE ?? RATE_LIMIT_DEFAULT_FAIL_MODE)
    .trim()
    .toLowerCase();

  return selectedFailMode === "block" ? "block" : "memory";
};

const setRateLimitHeaders = ({ res, limit, remaining, retryAfterMs }) => {
  const safeLimit = Math.max(0, Number(limit) || 0);
  const safeRemaining = Math.max(0, Number(remaining) || 0);
  const safeRetryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  const resetSeconds = Math.ceil(safeRetryAfterMs / 1000);

  res.set("RateLimit-Limit", String(safeLimit));
  res.set("RateLimit-Remaining", String(safeRemaining));
  res.set("RateLimit-Reset", String(resetSeconds));

  if (resetSeconds > 0) {
    res.set("Retry-After", String(resetSeconds));
  }
};

const warnRedisFallbackIfNeeded = (error) => {
  const currentTime = now();

  if (currentTime - lastRedisFallbackLogAt < RATE_LIMIT_REDIS_LOG_COOLDOWN_MS) {
    return;
  }

  lastRedisFallbackLogAt = currentTime;
  console.warn("[RateLimit] Fallback para memória após falha no Redis:", error?.message ?? error);
};

const applyInMemoryRateLimit = ({ key, currentTime, windowMs, max, message, res, next }) => {
  const bucket = clientBucketByKey.get(key);
  if (!bucket || bucket.expiresAt <= currentTime) {
    clientBucketByKey.set(key, {
      count: 1,
      expiresAt: currentTime + windowMs,
    });

    setRateLimitHeaders({
      res,
      limit: max,
      remaining: max - 1,
      retryAfterMs: windowMs,
    });

    return next();
  }

  if (bucket.count >= max) {
    const retryAfterMs = Math.max(0, bucket.expiresAt - currentTime);
    setRateLimitHeaders({
      res,
      limit: max,
      remaining: 0,
      retryAfterMs,
    });

    return next(createHttpError(message, 429, { retryAfterMs: bucket.expiresAt - currentTime }, "RATE_LIMITED"));
  }

  bucket.count += 1;
  clientBucketByKey.set(key, bucket);

  setRateLimitHeaders({
    res,
    limit: max,
    remaining: Math.max(0, max - bucket.count),
    retryAfterMs: Math.max(0, bucket.expiresAt - currentTime),
  });

  return next();
};

const applyRedisRateLimit = async ({ key, windowMs, max, message, res, next }) => {
  const redisKey = `${RATE_LIMIT_REDIS_KEY_PREFIX}:${key}`;
  const [count, ttl] = await redis.eval(RATE_LIMIT_WINDOW_LUA, 1, redisKey, windowMs);
  const numericCount = Number(count) || 0;
  const numericTtl = Math.max(0, Number(ttl) || 0);

  setRateLimitHeaders({
    res,
    limit: max,
    remaining: Math.max(0, max - numericCount),
    retryAfterMs: numericTtl,
  });

  if (numericCount > max) {
    return next(
      createHttpError(
        message,
        429,
        {
          retryAfterMs: numericTtl,
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

  if (typeof scope !== "string" || scope.trim().length === 0) {
    throw new Error("scope deve ser uma string não vazia");
  }

  const safeScope = scope.trim();
  const failMode = getFailMode();

  return async (req, res, next) => {
    const identity = getClientIdentity(req);
    const key = `${safeScope}:${identity}`;
    const currentTime = now();

    if (!shouldUseRedisStore()) {
      return applyInMemoryRateLimit({ key, currentTime, windowMs, max, message, res, next });
    }

    try {
      if (redis.status !== "end") {
        return await applyRedisRateLimit({ key, windowMs, max, message, res, next });
      }
    } catch (error) {
      if (failMode === "block") {
        return next(
          createHttpError(
            "Rate limit temporariamente indisponível",
            503,
            undefined,
            "RATE_LIMIT_UNAVAILABLE",
          ),
        );
      }

      warnRedisFallbackIfNeeded(error);
    }

    if (failMode === "block") {
      return next(
        createHttpError("Rate limit temporariamente indisponível", 503, undefined, "RATE_LIMIT_UNAVAILABLE"),
      );
    }

    return applyInMemoryRateLimit({ key, currentTime, windowMs, max, message, res, next });
  };
};
