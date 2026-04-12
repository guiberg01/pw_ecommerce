export const sendError = (res, status, message, errorCode, details) => {
  return res.status(status).json({
    success: false,
    message,
    errorCode,
    ...(details ? { details } : {}),
    timestamp: new Date().toISOString(),
  });
};
