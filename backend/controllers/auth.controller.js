// definindo as funções de controle para as rotas de autenticação
import User from "../models/user.model.js";

export const signup = async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: "Usuário já existe" });
    }

    const user = await User.create({ name, email, password });

    res.status(201).json({ message: "Usuário criado com sucesso", user });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const login = async (req, res) => {
  res.send("Rota de login chamada!");
};

export const logout = async (req, res) => {
  res.send("Rota de logout chamada!");
};
