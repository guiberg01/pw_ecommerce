import { createHttpError } from "../helpers/httpError.js";

const clientBucketByKey = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;

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

  return (req, res, next) => {
    const clientIp = getClientIp(req);
    const key = `${scope}:${clientIp}`;
    const currentTime = now();

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
};
