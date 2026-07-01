const Mensagem = require('../models/Mensagem');
const Match = require('../models/Match');
const { Op } = require('sequelize');

const enviarMensagem = async (req, res) => {
  try {
    const { match_id, conteudo } = req.body;
    const remetente_id = req.usuarioId;
    const match = await Match.findOne({ where: { id: match_id, ativo: true } });
    if (!match) return res.status(403).json({ erro: 'Match nao encontrado' });
    const mensagem = await Mensagem.create({ match_id, remetente_id, conteudo });
    res.status(201).json({ mensagem: 'Mensagem enviada!', dados: mensagem });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao enviar: ' + erro.message });
  }
};

const listarMensagens = async (req, res) => {
  try {
    const { match_id } = req.params;
    const mensagens = await Mensagem.findAll({ where: { match_id }, order: [['createdAt', 'ASC']] });
    res.json({ mensagens });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar: ' + erro.message });
  }
};

module.exports = { enviarMensagem, listarMensagens };
