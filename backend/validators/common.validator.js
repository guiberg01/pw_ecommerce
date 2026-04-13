import { z } from "zod";

export const mongoIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Identificador inválido");
