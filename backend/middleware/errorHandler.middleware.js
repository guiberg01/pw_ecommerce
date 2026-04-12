import { sendError } from "../helpers/errorResponse.js";

export const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err.code === "REDIS_UNAVAILABLE") {
    return sendError(
      res,
      503,
      "Serviço de autenticação temporariamente indisponível",
      "REDIS_UNAVAILABLE",
      err.details,
    );
  }

  if (err.name === "TokenExpiredError") {
    return sendError(res, 401, "Não autorizado - Token expirado", "TOKEN_EXPIRED");
  }

  if (err.name === "JsonWebTokenError") {
    return sendError(res, 401, "Não autorizado - Token inválido ou ausente", "TOKEN_INVALID");
  }

  if (err.name === "ValidationError") {
    return sendError(res, 400, "Requisição inválida - Falha na validação", "MONGOOSE_VALIDATION_ERROR", err.errors);
  }

  if (err.name === "CastError") {
    return sendError(res, 400, "Requisição inválida - Identificador inválido", "INVALID_IDENTIFIER");
  }

  if (err.name === "MongoServerError") {
    if (err.code === 11000) {
      return sendError(res, 409, "Conflito no banco de dados - Registro já existente", "DUPLICATE_KEY", err.keyValue);
    }

    return sendError(res, 500, "Erro no banco de dados", "DATABASE_ERROR");
  }

  if (err.statusCode) {
    return sendError(res, err.statusCode, err.message, "APPLICATION_ERROR", err.details);
  }

  return sendError(res, 500, "Erro interno do servidor", "INTERNAL_SERVER_ERROR");
};
