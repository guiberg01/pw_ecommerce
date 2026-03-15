import { Router } from "express";
import {
  logout,
  signup,
  login,
  refreshToken,
} from "../controllers/auth.controller.js";

// Criando o "roteador" para as rotas de autenticação
const router = Router();

// rotas (esse signup, login, logout ele ja ta puxando do controller)
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refreshToken);

export default router;
