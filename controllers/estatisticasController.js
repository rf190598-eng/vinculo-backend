const VisualizacaoPerfil = require('../models/VisualizacaoPerfil');
const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const Match = require('../models/Match');
const Mensagem = require('../models/Mensagem');
const DuplaMatch = require('../models/DuplaMatch');
const { Op } = require('sequelize');
const { temPremiumAtivo } = require('../utils/premium');
const { anexarGaleria, obterIdsBloqueados } = require('./swipeController');

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

const JANELA_VISITANTES_DIAS = 30;
const TAMANHO_PAGINA_VISITANTES = 20;

// "Quem visitou meu perfil" — a coleta (VisualizacaoPerfil, escrita em
// registrarVisualizacao acima) já existia e já rodava em produção pra todo
// mundo; só faltava esta leitura + o gate de Premium. Mesmo padrão de
// listarCurtidasRecebidas (swipeController.js): o TOTAL é público (alimenta
// o número que qualquer usuário vê), a LISTA de quem são só sai pra quem tem
// Premium ativo — sem premium o servidor nem busca os perfis, então não tem
// como vazar via aba de rede do navegador.
const listarVisitantesPerfil = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const eu = await Usuario.findByPk(usuario_id, { attributes: ['id', 'premium', 'premium_ate'] });

    const desde = new Date(Date.now() - JANELA_VISITANTES_DIAS * 24 * 60 * 60 * 1000);
    const visualizacoes = await VisualizacaoPerfil.findAll({
      where: { usuario_visto_id: usuario_id, createdAt: { [Op.gte]: desde } },
      order: [['createdAt', 'DESC']],
      attributes: ['usuario_visitante_id', 'createdAt']
    });

    // A mesma pessoa pode ter visitado várias vezes na janela — a lista é
    // "quem visitou", não "quantas vezes", então mantém só a visita mais
    // recente de cada visitante. A query já veio ordenada DESC, então a
    // primeira ocorrência de cada id É a mais recente.
    const visitadoEmPorVisitante = new Map();
    visualizacoes.forEach((v) => {
      if (!visitadoEmPorVisitante.has(v.usuario_visitante_id)) {
        visitadoEmPorVisitante.set(v.usuario_visitante_id, v.createdAt);
      }
    });

    // Remove quem está envolvido em bloqueio, nos dois sentidos — mesma regra
    // usada em todo o resto do app pra ninguém bloqueado aparecer em lista
    // nenhuma, mesmo que a visita tenha acontecido antes do bloqueio.
    const idsBloqueados = new Set(await obterIdsBloqueados(usuario_id));
    const idsVisitantes = Array.from(visitadoEmPorVisitante.keys())
      .filter((id) => !idsBloqueados.has(id));

    const total = idsVisitantes.length;

    if (!temPremiumAtivo(eu)) {
      return res.json({ total, visitantes: [], pagina: 1, total_paginas: total ? 1 : 0, premium: false });
    }

    const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA_VISITANTES));
    const pagina = Math.min(totalPaginas, Math.max(1, parseInt(req.query.pagina, 10) || 1));
    const inicio = (pagina - 1) * TAMANHO_PAGINA_VISITANTES;
    const idsPagina = idsVisitantes.slice(inicio, inicio + TAMANHO_PAGINA_VISITANTES);

    const perfis = await Usuario.findAll({
      where: { id: { [Op.in]: idsPagina } },
      attributes: { exclude: ['senha', 'foto_verificacao', 'foto_referencia_liveness'] }
    });
    const perfisComGaleria = await anexarGaleria(perfis);
    const perfilPorId = {};
    perfisComGaleria.forEach((p) => { perfilPorId[p.id] = p; });

    // Reordena pela ordem de idsPagina (mais recente primeiro) — findAll com
    // Op.in não garante ordem — e anexa quando foi a visita, já que isso não
    // é um campo do próprio Usuario. Perfis de contas excluídas nesse meio
    // tempo simplesmente não aparecem (perfilPorId[id] undefined).
    const visitantes = idsPagina
      .filter((id) => perfilPorId[id])
      .map((id) => ({ ...perfilPorId[id], visitado_em: visitadoEmPorVisitante.get(id) }));

    res.json({ total, visitantes, pagina, total_paginas: totalPaginas, premium: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar visitantes: ' + erro.message });
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
  registrarVisualizacao, obterMinhasEstatisticas, listarVisitantesPerfil,
  listarNotificacoes, marcarNotificacoesLidas,
  obterEstatisticasAdmin
};
