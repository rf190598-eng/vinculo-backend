const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Usuario = require('../models/Usuario');
const TokenRevogado = require('../models/TokenRevogado');
const { resolverParceiroPorCodigo } = require('./parceiroController');

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
    // 'ref' = código do Programa de Parceiros (novo, comissão em R$).
    // Aceito também via query string, porque o link curto /r/:codigo pode
    // chegar como ?ref= dependendo de como o front repassa.
    // NÃO confundir com codigo_indicacao_usado, que é do sistema antigo entre
    // usuários e continua funcionando igual (as Duplas dependem dele).
    const { nome, email, senha, data_nascimento, genero, pref_genero, codigo_indicacao_usado } = req.body;
    const refParceiro = req.body.ref || req.query.ref || null;

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

    // Programa de Parceiros: guarda QUAL parceiro trouxe este usuário. A
    // indicação em si (linha em "indicacoes") só nasce quando ele confirmar a
    // identidade — ver registrarIndicacaoSeAplicavel no perfilController.
    // Um código inválido ou de parceiro suspenso resolve pra null e o cadastro
    // segue normal: link ruim nunca pode impedir alguém de criar conta.
    let indicado_por_parceiro_id = null;
    try {
      indicado_por_parceiro_id = await resolverParceiroPorCodigo(refParceiro);
    } catch (erroRef) {
      console.warn('Falha ao resolver código de parceiro no cadastro:', erroRef.message);
    }

    let usuario;
    try {
      usuario = await Usuario.create({
        nome: nomeLimpo, email: emailNormalizado, senha: senhaCriptografada, data_nascimento, genero, pref_genero,
        codigo_indicacao, indicado_por, indicado_por_parceiro_id
      });
    } catch (erroCriacao) {
      if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({ erro: 'Email já cadastrado' });
      }
      throw erroCriacao;
    }

    const token = jwt.sign({ id: usuario.id, email: usuario.email, jti: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const usuarioCompleto = await Usuario.findByPk(usuario.id, { attributes: { exclude: ['senha', 'foto_verificacao', 'foto_referencia_liveness'] } });
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

    // Suspensão administrativa (Lote 3): barra o login com uma mensagem
    // clara, sem revelar motivo interno. A mesma checagem também roda em
    // toda requisição autenticada (authMiddleware) — aqui é só pra dar um
    // erro específico já na tela de login, em vez do genérico de token.
    if (usuario.suspenso_permanente) {
      return res.status(403).json({ erro: 'Esta conta foi banida.' });
    }
    if (usuario.suspenso_ate && new Date(usuario.suspenso_ate) > new Date()) {
      return res.status(403).json({
        erro: `Esta conta está suspensa até ${new Date(usuario.suspenso_ate).toLocaleDateString('pt-BR')}.`
      });
    }

    const token = jwt.sign({ id: usuario.id, email: usuario.email, jti: crypto.randomUUID() }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const usuarioCompleto = await Usuario.findByPk(usuario.id, { attributes: { exclude: ['senha', 'foto_verificacao', 'foto_referencia_liveness'] } });
    res.json({ mensagem: 'Login realizado!', token, usuario: usuarioCompleto });
  } catch (erro) {
    console.error('Erro ao fazer login:', erro);
    res.status(500).json({ erro: 'Não foi possível fazer login. Tente novamente.' });
  }
};

const perfil = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: { exclude: ['senha', 'foto_verificacao', 'foto_referencia_liveness'] } });
    res.json(usuario);
  } catch (erro) {
    console.error('Erro ao buscar perfil:', erro);
    res.status(500).json({ erro: 'Não foi possível buscar o perfil.' });
  }
};

// POST /api/auth/logout — correção do achado IMPORTANTE da auditoria (sem
// logout/revogação de JWT). Coloca o jti do token atual na blacklist, então
// authMiddleware passa a rejeitá-lo mesmo dentro dos 30 dias de validade.
// Tokens antigos (emitidos antes desta correção) não têm jti — não tem como
// revogar individualmente, então só encerra a sessão localmente no app.
const logout = async (req, res) => {
  try {
    if (!req.tokenJti || !req.tokenExp) {
      return res.json({ mensagem: 'Sessão encerrada.' });
    }
    await TokenRevogado.findOrCreate({
      where: { jti: req.tokenJti },
      defaults: { usuario_id: req.usuarioId, expira_em: new Date(req.tokenExp * 1000) }
    });
    res.json({ mensagem: 'Sessão encerrada.' });
  } catch (erro) {
    console.error('Erro ao encerrar sessão:', erro);
    res.status(500).json({ erro: 'Não foi possível encerrar a sessão.' });
  }
};

module.exports = { cadastrar, login, perfil, logout };
