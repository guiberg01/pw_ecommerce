export const createHttpError = (message, statusCode, details, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;

  if (details !== undefined) {
    error.details = details;
  }

  if (code !== undefined) {
    error.code = code;
  }

  return error;
};
