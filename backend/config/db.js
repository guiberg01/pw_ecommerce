import mongoose from "mongoose";

//conexão com o banco de dados, usando a string de conexão do .env
export const connectDB = async () => {
  try {
    const db = await mongoose.connect(process.env.DB_URI);
    console.log(
      `Conectado ao banco de dados MongoDB em: ${db.connection.host}`,
    );
  } catch (error) {
    console.error("Erro ao conectar ao banco de dados:", error.message);
    process.exit(1);
  }
};
