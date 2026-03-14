// importando os módulos necessários
import express from "express";
import dotenv from "dotenv";

// Configuração de DNS para evitar problemas de conexão
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Routes
import authRoutes from "./routes/auth.route.js";

// Database
import { connectDB } from "./config/db.js";

//Inicializa variaveis .env
dotenv.config();

// Criação do servidor Express
const app = express();
const PORT = process.env.PORT || 3980;

// Middleware pra funcionar req JSON
app.use(express.json());

// Definindo rota auth
app.use("/api/auth", authRoutes);

// Iniciando o servidor
app.listen(PORT, () => {
  console.log(`Server rodando em: http://localhost:${PORT}`);
  connectDB();
});
