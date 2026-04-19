import { createHttpError } from "../helpers/httpError.js";

const validate = (schema, target) => {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const validationError = createHttpError(
        "Requisição inválida - Falha na validação",
        400,
        undefined,
        "REQUEST_VALIDATION_FAILED",
      );
      validationError.details = result.error.flatten();
      return next(validationError);
    }

    if (target === "query") {
      req.validatedQuery = result.data;
    } else {
      req[target] = result.data;
    }

    next();
  };
};

export const validateBody = (schema) => validate(schema, "body");
export const validateParams = (schema) => validate(schema, "params");
export const validateQuery = (schema) => validate(schema, "query");
