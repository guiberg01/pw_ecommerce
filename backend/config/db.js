import mongoose from "mongoose";

//conexão com o banco de dados, usando a string de conexão do .env
export const connectDB = async () => {
  const db = await mongoose.connect(process.env.DB_URI);
  console.log(`Conectado ao banco de dados MongoDB em: ${db.connection.host}`);
  return db;
};

export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
};
