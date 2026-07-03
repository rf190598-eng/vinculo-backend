const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');

const darSwipe = async (req, res) => {
  try {
    const { alvo_id, tipo } = req.body;
    const usuario_id = req.usuarioId;

    // Verificar se já deu swipe nesse perfil
    const swipeExiste = await Swipe.findOne({
      where: { usuario_id, alvo_id }
    });

    if (swipeExiste) {
      return res.status(400).json({ erro: 'Você já avaliou esse perfil' });
    }

    // Criar swipe
    await Swipe.create({ usuario_id, alvo_id, tipo });

    // Verificar match (se tipo for like ou superlike)
    let match = null;
    if (tipo === 'like' || tipo === 'superlike') {
      const swipeRecíproco = await Swipe.findOne({
        where: {
          usuario_id: alvo_id,
          alvo_id: usuario_id,
          tipo: ['like', 'superlike']
        }
      });

      if (swipeRecíproco) {
        // Criar match!
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

    // Buscar IDs que já foram avaliados
    const jaAvaliados = await Swipe.findAll({
      where: { usuario_id },
      attributes: ['alvo_id']
    });

    const idsAvaliados = jaAvaliados.map(s => s.alvo_id);
    idsAvaliados.push(usuario_id); // não mostrar o próprio perfil

    // Buscar perfis disponíveis
    const { Op } = require('sequelize');
    const perfis = await Usuario.findAll({
      where: {
        id: { [Op.notIn]: idsAvaliados },
        ativo: true
      },
     attributes: { exclude: ['senha', 'foto_verificacao'] },
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
module.exports = { darSwipe, listarPerfis, listarMatches }; 
