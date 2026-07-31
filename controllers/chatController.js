const Mensagem = require('../models/Mensagem');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const { Op } = require('sequelize');

const enviarMensagem = async (req, res) => {
  try {
    const { match_id, conteudo } = req.body;
    const remetente_id = req.usuarioId;

    if (!match_id || !conteudo || !String(conteudo).trim()) {
      return res.status(400).json({ erro: 'match_id e conteudo são obrigatórios' });
    }

    const match = await Match.findOne({
      where: {
        id: match_id,
        ativo: true,
        [Op.or]: [{ usuario1_id: remetente_id }, { usuario2_id: remetente_id }]
      }
    });
    if (!match) return res.status(403).json({ erro: 'Match não encontrado ou você não faz parte dele' });

    const conteudoLimpo = String(conteudo).replace(/<[^>]*>/g, '').trim().slice(0, 2000);
    const mensagem = await Mensagem.create({ match_id, remetente_id, conteudo: conteudoLimpo });

    const destinatario_id = match.usuario1_id === remetente_id ? match.usuario2_id : match.usuario1_id;
    const remetente = await Usuario.findByPk(remetente_id);
    await Notificacao.create({
      usuario_id: destinatario_id,
      tipo: 'mensagem',
      texto: `${remetente.nome} te mandou uma mensagem!`
    });

    res.status(201).json({ mensagem: 'Mensagem enviada!', dados: mensagem });
  } catch (erro) {
    console.error('Erro ao enviar mensagem:', erro);
    res.status(500).json({ erro: 'Não foi possível enviar a mensagem.' });
  }
};

const listarMensagens = async (req, res) => {
  try {
    const { match_id } = req.params;
    const usuario_id = req.usuarioId;

    const match = await Match.findOne({
      where: {
        id: match_id,
        [Op.or]: [{ usuario1_id: usuario_id }, { usuario2_id: usuario_id }]
      }
    });
    if (!match) return res.status(403).json({ erro: 'Match não encontrado ou você não faz parte dele' });

    const mensagens = await Mensagem.findAll({ where: { match_id }, order: [['createdAt', 'ASC']] });
    res.json({ mensagens });
  } catch (erro) {
    console.error('Erro ao listar mensagens:', erro);
    res.status(500).json({ erro: 'Não foi possível carregar as mensagens.' });
  }
};

module.exports = { enviarMensagem, listarMensagens };
