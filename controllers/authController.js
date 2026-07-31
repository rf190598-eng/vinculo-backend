const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENEROS_VALIDOS = ['masculino', 'feminino', 'nao-binario'];
const PREF_GENERO_VALIDOS = ['masculino', 'feminino', 'todos'];

function gerarCodigoIndicacao(nome) {
  const base = (nome || 'user').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').slice(0, 10) || 'user';
  const numero = Math.floor(1000 + Math.random() * 9000);
  return base + numero;
}

const cadastrar = async (req, res) => {
  try {
    const { nome, email, senha, data_nascimento, genero, pref_genero, codigo_indicacao_usado } = req.body;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório' });
    }
    const nomeLimpo = String(nome).replace(/<[^>]*>/g, '').trim().slice(0, 100);

    if (!email || !REGEX_EMAIL.test(String(email).trim())) {
      return res.status(400).json({ erro: 'E-mail inválido' });
    }
    const emailNormalizado = String(email).trim().toLowerCase();

    if (!senha || String(senha).length < 6) {
      return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres' });
    }

    if (genero && !GENEROS_VALIDOS.includes(genero)) {
      return res.status(400).json({ erro: 'Gênero inválido' });
    }
    if (pref_genero && !PREF_GENERO_VALIDOS.includes(pref_genero)) {
      return res.status(400).json({ erro: 'Preferência de gênero inválida' });
    }

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

    const usuarioExiste = await Usuario.findOne({ where: { email: emailNormalizado } });
    if (usuarioExiste) return res.status(400).json({ erro: 'Email já cadastrado' });

    const senhaCriptografada = await bcrypt.hash(senha, 10);

    let codigo_indicacao = gerarCodigoIndicacao(nomeLimpo);
    let tentativas = 0;
    while (await Usuario.findOne({ where: { codigo_indicacao } }) && tentativas < 5) {
      codigo_indicacao = gerarCodigoIndicacao(nomeLimpo);
      tentativas++;
    }

    let indicado_por = null;
    if (codigo_indicacao_usado) {
      const referenciador = await Usuario.findOne({ where: { codigo_indicacao: codigo_indicacao_usado } });
      if (referenciador) indicado_por = referenciador.codigo_indicacao;
    }

    let usuario;
    try {
      usuario = await Usuario.create({
        nome: nomeLimpo, email: emailNormalizado, senha: senhaCriptografada, data_nascimento, genero, pref_genero,
        codigo_indicacao, indicado_por
      });
    } catch (erroCriacao) {
      if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({ erro: 'Email já cadastrado' });
      }
      throw erroCriacao;
    }

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const usuarioCompleto = await Usuario.findByPk(usuario.id, { attributes: { exclude: ['senha', 'foto_verificacao'] } });
    res.status(201).json({ mensagem: 'Cadastro realizado!', token, usuario: usuarioCompleto });
  } catch (erro) {
    console.error('Erro ao cadastrar:', erro);
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
};

const login = async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ erro: 'Email ou senha incorretos' });
    }
    const emailNormalizado = String(email).trim().toLowerCase();
    const usuario = await Usuario.findOne({ where: { email: emailNormalizado } });
    if (!usuario) return res.status(401).json({ erro: 'Email ou senha incorretos' });
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) return res.status(401).json({ erro: 'Email ou senha incorretos' });
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const usuarioCompleto = await Usuario.findByPk(usuario.id, { attributes: { exclude: ['senha', 'foto_verificacao'] } });
    res.json({ mensagem: 'Login realizado!', token, usuario: usuarioCompleto });
  } catch (erro) {
    console.error('Erro ao fazer login:', erro);
    res.status(500).json({ erro: 'Não foi possível fazer login. Tente novamente.' });
  }
};

const perfil = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: { exclude: ['senha', 'foto_verificacao'] } });
    res.json(usuario);
  } catch (erro) {
    console.error('Erro ao buscar perfil:', erro);
    res.status(500).json({ erro: 'Não foi possível buscar o perfil.' });
  }
};

module.exports = { cadastrar, login, perfil };
