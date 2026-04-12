const validate = (schema, target) => {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const validationError = new Error("Requisição inválida - Falha na validação");
      validationError.statusCode = 400;
      validationError.details = result.error.flatten();
      return next(validationError);
    }

    req[target] = result.data;
    next();
  };
};

export const validateBody = (schema) => validate(schema, "body");
export const validateParams = (schema) => validate(schema, "params");
