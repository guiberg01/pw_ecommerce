import express from "express";
import dotenv from "dotenv";

// Configuração de DNS para evitar problemas de conexão
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Routes
import authRoutes from "./routes/auth.route.js";

// Database
import { connectDB } from "./config/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3980;

app.use("/api/auth", authRoutes);

app.listen(PORT, () => {
  console.log(`Server rodando em: http://localhost:${PORT}`);
  connectDB();
});
