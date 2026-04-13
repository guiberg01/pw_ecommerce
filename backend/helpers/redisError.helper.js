import { createHttpError } from "./httpError.js";

export const createRedisUnavailableError = (context, operation, originalError) => {
  return createHttpError(
    `${context} temporariamente indisponível (${operation})`,
    503,
    {
      operation,
      reason: originalError?.message,
    },
    "REDIS_UNAVAILABLE",
  );
};
