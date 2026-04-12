import { Router } from "express";
import { logout, signup, login, refreshToken } from "../controllers/auth.controller.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { loginSchema, signupSchema } from "../validators/auth.validator.js";

// Criando o "roteador" para as rotas de autenticação
const router = Router();

// rotas (esse signup, login, logout ele ja ta puxando do controller)
router.post("/signup", validateBody(signupSchema), signup);
router.post("/login", validateBody(loginSchema), login);
router.post("/logout", logout);
router.post("/refresh", refreshToken);

export default router;
