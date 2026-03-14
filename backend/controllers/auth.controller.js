// definindo as funções de controle para as rotas de autenticação

export const signup = async (req, res) => {
  res.send("Rota de cadastro chamada!");
};

export const login = async (req, res) => {
  res.send("Rota de login chamada!");
};

export const logout = async (req, res) => {
  res.send("Rota de logout chamada!");
};
