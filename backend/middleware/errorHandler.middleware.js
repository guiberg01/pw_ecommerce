export const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ message: "Não autorizado - Token expirado" });
  }
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ message: "Não autorizado - Token inválido ou ausente" });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({ message: "Requisição inválida - Falha na validação", details: err.errors });
  }

  if (err.name === "MongoServerError") {
    return res.status(500).json({ message: "Erro no banco de dados" });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  return res.status(500).json({ message: "Erro interno do servidor" });
};
