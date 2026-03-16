export const validateBody = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const validationError = new Error("Requisição inválida - Falha na validação");
      validationError.statusCode = 400;
      validationError.details = result.error.flatten();
      return next(validationError);
    }

    req.body = result.data;
    next();
  };
};
