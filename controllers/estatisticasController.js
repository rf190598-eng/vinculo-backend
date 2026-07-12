const VisualizacaoPerfil = require('../models/VisualizacaoPerfil');
const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const Match = require('../models/Match');
const Mensagem = require('../models/Mensagem');
const DuplaMatch = require('../models/DuplaMatch');

const EMAIL_ADMIN = 'rf190598@gmail.com';

async function souAdmin(usuarioId) {
  const usuario = await Usuario.findByPk(usuarioId);
  return usuario && usuario.email === EMAIL_ADMIN;
}

const registrarVisualizacao = async (req, res) => {
  try {
    const { usuario_visto_id } = req.body;
    if (usuario_visto_id === req.usuarioId) {
      return res.json({ mensagem: 'Visualização própria, não contabilizada' });
    }
    await VisualizacaoPerfil.create({ usuario_visto_id, usuario_visitante_id: req.usuarioId });
    res.status(201).json({ mensagem: 'Visualização registrada' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao registrar visualização: ' + erro.message });
  }
};

const obterMinhasEstatisticas = async (req, res) => {
  try {
    const totalVisualizacoes = await VisualizacaoPerfil.count({ where: { usuario_visto_id: req.usuarioId } });
    res.json({ visualizacoes: totalVisualizacoes });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar estatísticas: ' + erro.message });
  }
};

const listarNotificacoes = async (req, res) => {
  try {
    const notificacoes = await Notificacao.findAll({
      where: { usuario_id: req.usuarioId },
      order: [['createdAt', 'DESC']],
      limit: 30
    });
    const naoLidas = await Notificacao.count({ where: { usuario_id: req.usuarioId, lida: false } });
    res.json({ notificacoes, nao_lidas: naoLidas });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar notificações: ' + erro.message });
  }
};

const marcarNotificacoesLidas = async (req, res) => {
  try {
    await Notificacao.update({ lida: true }, { where: { usuario_id: req.usuarioId, lida: false } });
    res.json({ mensagem: 'Notificações marcadas como lidas' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao marcar notificações: ' + erro.message });
  }
};

const obterEstatisticasAdmin = async (req, res) => {
  try {
    if (!(await souAdmin(req.usuarioId))) {
      return res.status(403).json({ erro: 'Acesso restrito' });
    }
    const { Op } = require('sequelize');
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const totalUsuarios = await Usuario.count();
    const usuariosVerificados = await Usuario.count({ where: { verificado: true } });
    const usuariosPremium = await Usuario.count({ where: { premium: true } });
    const cadastrosHoje = await Usuario.count({ where: { createdAt: { [Op.gte]: hoje } } });
    const totalMatches = await Match.count();
    const matchesHoje = await Match.count({ where: { createdAt: { [Op.gte]: hoje } } });
    const totalMensagens = await Mensagem.count();
    const totalDuplaMatches = await DuplaMatch.count();

    res.json({
      total_usuarios: totalUsuarios,
      usuarios_verificados: usuariosVerificados,
      usuarios_premium: usuariosPremium,
      cadastros_hoje: cadastrosHoje,
      total_matches: totalMatches,
      matches_hoje: matchesHoje,
      total_mensagens: totalMensagens,
      total_dupla_matches: totalDuplaMatches
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar estatísticas: ' + erro.message });
  }
};

module.exports = {
  registrarVisualizacao, obterMinhasEstatisticas,
  listarNotificacoes, marcarNotificacoesLidas,
  obterEstatisticasAdmin
};
