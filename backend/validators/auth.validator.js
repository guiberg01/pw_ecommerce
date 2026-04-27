import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  email: z
    .string()
    .trim()
    .pipe(z.email({ error: "Email inválido" })),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
  role: z.enum(["customer", "seller"]).optional().default("customer"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email({ error: "Email inválido" })),
  password: z.string().min(1, "Senha é obrigatória"),
});
