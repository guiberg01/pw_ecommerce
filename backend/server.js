// importando os módulos necessários
import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { errorHandler } from "./middleware/errorHandler.middleware.js";

// Configuração de DNS para evitar problemas de conexão
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Routes
import authRoutes from "./routes/auth.route.js";
import adminRoutes from "./routes/admin.route.js";
import productRoutes from "./routes/product.route.js";
import storeRoutes from "./routes/store.route.js";
import cartRoutes from "./routes/cart.route.js";

// Database
import { connectDB } from "./config/db.js";

//Inicializa variaveis .env
dotenv.config();

// Criação do servidor Express
const app = express();
const PORT = process.env.PORT || 3980;

// Middleware pra funcionar req JSON
app.use(express.json());
app.use(cookieParser());

// Definindo rota auth
app.use("/api/auth", authRoutes);

// Definindo rota admin
app.use("/api/admin", adminRoutes);

// Definindo rota products
app.use("/api/products", productRoutes);

// Definindo rota stores
app.use("/api/stores", storeRoutes);

// Definindo a rota do carrinho
app.use("/api/cart", cartRoutes);

// Middleware para rotas não encontradas
app.use((req, res, next) => {
  const error = new Error("Rota não encontrada");
  error.statusCode = 404;
  next(error);
});

// Middleware de tratamento de erros
app.use(errorHandler);

const bootstrap = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server rodando em: http://localhost:${PORT}`);
  });
};

bootstrap();
