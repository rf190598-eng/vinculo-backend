const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const cadastrar = async (req, res) => {
  try {
    const { nome, email, senha, data_nascimento, genero } = req.body;
    const usuarioExiste = await Usuario.findOne({ where: { email } });
    if (usuarioExiste) return res.status(400).json({ erro: 'Email ja cadastrado' });
    const senhaCriptografada = await bcrypt.hash(senha, 10);
    const usuario = await Usuario.create({ nome, email, senha: senhaCriptografada, data_nascimento, genero });
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ mensagem: 'Cadastro realizado!', token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, verificado: usuario.verificado, premium: usuario.premium } });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao cadastrar: ' + erro.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await Usuario.findOne({ where: { email } });
    if (!usuario) return res.status(401).json({ erro: 'Email ou senha incorretos' });
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) return res.status(401).json({ erro: 'Email ou senha incorretos' });
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ mensagem: 'Login realizado!', token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, verificado: usuario.verificado, premium: usuario.premium } });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao fazer login: ' + erro.message });
  }
};

const perfil = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: { exclude: ['senha'] } });
    res.json(usuario);
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar perfil: ' + erro.message });
  }
};

module.exports = { cadastrar, login, perfil };
