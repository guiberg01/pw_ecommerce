import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { createHttpError } from "./helpers/httpError.js";
import { errorHandler } from "./middleware/errorHandler.middleware.js";

import dns from "dns";

import authRoutes from "./routes/auth.route.js";
import adminRoutes from "./routes/admin.route.js";
import productRoutes from "./routes/product.route.js";
import storeRoutes from "./routes/store.route.js";
import cartRoutes from "./routes/cart.route.js";

import { connectDB, disconnectDB } from "./config/db.js";
import { disconnectRedis } from "./config/redis.js";

dotenv.config();

if (process.env.DNS_SERVERS) {
  const dnsServers = process.env.DNS_SERVERS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
  }
}

const REQUIRED_ENV_VARS = ["DB_URI", "REDIS_URL", "ACCESS_TOKEN", "REFRESH_TOKEN"];

const validateRequiredEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw createHttpError(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(", ")}`,
      500,
      { missing },
      "ENV_VALIDATION_FAILED",
    );
  }
};

const app = express();
const PORT = process.env.PORT || 3980;
let httpServer;
let shuttingDown = false;

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/cart", cartRoutes);

app.use((req, res, next) => {
  next(createHttpError("Rota não encontrada", 404, undefined, "ROUTE_NOT_FOUND"));
});

app.use(errorHandler);

const bootstrap = async () => {
  try {
    validateRequiredEnv();
    await connectDB();

    httpServer = app.listen(PORT, () => {
      console.log(`Server rodando em: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Falha ao inicializar servidor:", error);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Recebido ${signal}. Encerrando aplicação...`);

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) return reject(error);
          return resolve();
        });
      });
    }

    await disconnectDB();
    await disconnectRedis();

    process.exit(0);
  } catch (error) {
    console.error("Erro durante shutdown gracioso:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

bootstrap();
