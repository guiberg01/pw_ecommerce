import { Router } from "express";
import { logout, signup, login, refreshToken } from "../controllers/auth.controller.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { createRateLimit } from "../middleware/rateLimit.middleware.js";
import { loginSchema, signupSchema } from "../validators/auth.validator.js";

// Criando o "roteador" para as rotas de autenticação
const router = Router();

const signupRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  scope: "auth:signup",
  message: "Muitas tentativas de cadastro. Tente novamente em alguns minutos.",
});

const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  scope: "auth:login",
  message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
});

const refreshRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  scope: "auth:refresh",
  message: "Muitas tentativas de renovação de sessão. Aguarde um pouco e tente novamente.",
});

// rotas (esse signup, login, logout ele ja ta puxando do controller)
router.post("/signup", signupRateLimit, validateBody(signupSchema), signup);
router.post("/login", loginRateLimit, validateBody(loginSchema), login);
router.post("/logout", logout);
router.post("/refresh", refreshRateLimit, refreshToken);

export default router;
