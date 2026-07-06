const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

function gerarCodigoIndicacao(nome) {
  const base = (nome || 'user').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').slice(0, 10) || 'user';
  const numero = Math.floor(1000 + Math.random() * 9000);
  return base + numero;
}

const cadastrar = async (req, res) => {
  try {
    const { nome, email, senha, data_nascimento, genero, codigo_indicacao_usado } = req.body;

    const nascimento = new Date(data_nascimento);
    if (isNaN(nascimento.getTime())) {
      return res.status(400).json({ erro: 'Data de nascimento inválida' });
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const aindaNaoFezAniversario = (hoje.getMonth() < nascimento.getMonth()) ||
      (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate());
    if (aindaNaoFezAniversario) idade--;
    if (idade < 18) {
      return res.status(400).json({ erro: 'É preciso ter 18 anos ou mais para se cadastrar' });
    }

    const usuarioExiste = await Usuario.findOne({ where: { email } });
    if (usuarioExiste) return res.status(400).json({ erro: 'Email ja cadastrado' });

    const senhaCriptografada = await bcrypt.hash(senha, 10);

    let codigo_indicacao = gerarCodigoIndicacao(nome);
    let tentativas = 0;
    while (await Usuario.findOne({ where: { codigo_indicacao } }) && tentativas < 5) {
      codigo_indicacao = gerarCodigoIndicacao(nome);
      tentativas++;
    }

    let indicado_por = null;
    if (codigo_indicacao_usado) {
      const referenciador = await Usuario.findOne({ where: { codigo_indicacao: codigo_indicacao_usado } });
      if (referenciador) indicado_por = referenciador.codigo_indicacao;
    }

    const usuario = await Usuario.create({
      nome, email, senha: senhaCriptografada, data_nascimento, genero,
      codigo_indicacao, indicado_por
    });

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({
      mensagem: 'Cadastro realizado!',
      token,
      usuario: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        verificado: usuario.verificado, premium: usuario.premium,
        codigo_indicacao: usuario.codigo_indicacao
      }
    });
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
    res.json({
      mensagem: 'Login realizado!',
      token,
      usuario: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        verificado: usuario.verificado, premium: usuario.premium,
        codigo_indicacao: usuario.codigo_indicacao
      }
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao fazer login: ' + erro.message });
  }
};

const perfil = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: { exclude: ['senha', 'foto_verificacao'] } });
    res.json(usuario);
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar perfil: ' + erro.message });
  }
};

module.exports = { cadastrar, login, perfil };
