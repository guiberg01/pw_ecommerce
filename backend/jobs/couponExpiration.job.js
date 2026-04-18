import { randomUUID } from "crypto";
import { redis } from "../config/redis.js";
import { markExpiredCoupons } from "../services/coupon.service.js";

const LOCK_KEY = "jobs:coupon-expiration:lock";
const LOCK_TTL_MS = Number(process.env.COUPON_EXPIRATION_LOCK_TTL_MS ?? 45_000);
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = Number(process.env.COUPON_EXPIRATION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);

const releaseLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

let intervalId = null;
let isRunningLocally = false;

const acquireLock = async () => {
  const lockToken = randomUUID();
  const acquired = await redis.set(LOCK_KEY, lockToken, "PX", LOCK_TTL_MS, "NX");

  if (acquired !== "OK") {
    return null;
  }

  return lockToken;
};

const releaseLock = async (lockToken) => {
  try {
    await redis.eval(releaseLockScript, 1, LOCK_KEY, lockToken);
  } catch (error) {
    console.error("[coupon-expiration] erro ao liberar lock:", error);
  }
};

const runOnce = async () => {
  if (isRunningLocally) {
    return;
  }

  isRunningLocally = true;
  let lockToken;

  try {
    lockToken = await acquireLock();

    if (!lockToken) {
      return;
    }

    const now = new Date();
    const result = await markExpiredCoupons(now);

    if (result.modifiedCount > 0) {
      console.log(`[coupon-expiration] ${result.modifiedCount} cupom(ns) marcados como expirados`);
    }
  } catch (error) {
    console.error("[coupon-expiration] falha ao executar job:", error);
  } finally {
    if (lockToken) {
      await releaseLock(lockToken);
    }

    isRunningLocally = false;
  }
};

export const startCouponExpirationScheduler = () => {
  if (intervalId) {
    return () => {
      clearInterval(intervalId);
      intervalId = null;
    };
  }

  void runOnce();
  intervalId = setInterval(() => {
    void runOnce();
  }, INTERVAL_MS);

  return () => {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  };
};
