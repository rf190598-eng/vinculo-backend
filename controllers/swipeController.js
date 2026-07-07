const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');

const darSwipe = async (req, res) => {
  try {
    const { alvo_id, tipo } = req.body;
    const usuario_id = req.usuarioId;
    const swipeExiste = await Swipe.findOne({
      where: { usuario_id, alvo_id }
    });
    if (swipeExiste) {
      return res.status(400).json({ erro: 'Você já avaliou esse perfil' });
    }
    await Swipe.create({ usuario_id, alvo_id, tipo });
    let match = null;
    if (tipo === 'like' || tipo === 'superlike') {
      const swipeReciproco = await Swipe.findOne({
        where: {
          usuario_id: alvo_id,
          alvo_id: usuario_id,
          tipo: ['like', 'superlike']
        }
      });
      if (swipeReciproco) {
        match = await Match.create({
          usuario1_id: usuario_id,
          usuario2_id: alvo_id
        });
      }
    }
    if (match) {
      return res.json({
        mensagem: 'É um Vínculo!',
        match: true,
        match_id: match.id
      });
    }
    res.json({
      mensagem: 'Swipe registrado!',
      match: false
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao dar swipe: ' + erro.message });
  }
};

const listarPerfis = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const jaAvaliados = await Swipe.findAll({
      where: { usuario_id },
      attributes: ['alvo_id']
    });
    const idsAvaliados = jaAvaliados.map(s => s.alvo_id);
    idsAvaliados.push(usuario_id);
    const { Op } = require('sequelize');
    const perfis = await Usuario.findAll({
      where: {
        id: { [Op.notIn]: idsAvaliados },
        ativo: true
      },
      attributes: { exclude: ['senha', 'foto_verificacao'] },
      limit: 10
    });
    res.json({ perfis });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar perfis: ' + erro.message });
  }
};

const listarMatches = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { Op } = require('sequelize');
    const matches = await Match.findAll({
      where: {
        [Op.or]: [
          { usuario1_id: usuario_id },
          { usuario2_id: usuario_id }
        ],
        ativo: true
      }
    });

    const matchesComPerfil = await Promise.all(matches.map(async (match) => {
      const outroId = match.usuario1_id === usuario_id ? match.usuario2_id : match.usuario1_id;
      const outroUsuario = await Usuario.findByPk(outroId, {
        attributes: ['id', 'nome', 'foto_url', 'verificado', 'data_nascimento']
      });
      return {
        id: match.id,
        criado_em: match.createdAt,
        outro_usuario: outroUsuario
      };
    }));

    res.json({ matches: matchesComPerfil });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar matches: ' + erro.message });
  }
};

const listarCurtidasRecebidas = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { Op } = require('sequelize');

    const curtidasRecebidas = await Swipe.findAll({
      where: { alvo_id: usuario_id, tipo: ['like', 'superlike'] }
    });

    const meusSwipes = await Swipe.findAll({
      where: { usuario_id },
      attributes: ['alvo_id']
    });
    const jaAvaliadosPorMim = meusSwipes.map(s => s.alvo_id);

    const pendentes = curtidasRecebidas.filter(c => !jaAvaliadosPorMim.includes(c.usuario_id));

    const idsPendentes = pendentes.map(p => p.usuario_id);
    const perfis = await Usuario.findAll({
      where: { id: { [Op.in]: idsPendentes } },
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });

    res.json({ total: perfis.length, perfis });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar curtidas: ' + erro.message });
  }
};

module.exports = { darSwipe, listarPerfis, listarMatches, listarCurtidasRecebidas };
