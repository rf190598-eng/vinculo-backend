const Evento = require('../models/Evento');
const EventoConfirmacao = require('../models/EventoConfirmacao');
const Usuario = require('../models/Usuario');

const EMAIL_ADMIN = 'rf190598@gmail.com';

async function souAdmin(usuarioId) {
  const usuario = await Usuario.findByPk(usuarioId);
  return usuario && usuario.email === EMAIL_ADMIN;
}

const listarEventos = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const eventos = await Evento.findAll({
      where: { ativo: true, data_hora: { [Op.gte]: new Date() } },
      order: [['data_hora', 'ASC']]
    });

    const eventosComDados = await Promise.all(eventos.map(async (evento) => {
      const confirmados = await EventoConfirmacao.count({ where: { evento_id: evento.id } });
      const euConfirmei = await EventoConfirmacao.findOne({
        where: { evento_id: evento.id, usuario_id: req.usuarioId }
      });
      return {
        id: evento.id,
        nome: evento.nome,
        descricao: evento.descricao,
        local: evento.local,
        data_hora: evento.data_hora,
        preco: evento.preco,
        emoji: evento.emoji,
        confirmados,
        eu_confirmei: !!euConfirmei
      };
    }));

    res.json({ eventos: eventosComDados });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar eventos: ' + erro.message });
  }
};

const criarEvento = async (req, res) => {
  try {
    if (!(await souAdmin(req.usuarioId))) {
      return res.status(403).json({ erro: 'Apenas administradores podem criar eventos' });
    }
    const { nome, descricao, local, data_hora, preco, emoji } = req.body;
    if (!nome || !local || !data_hora) {
      return res.status(400).json({ erro: 'Nome, local e data são obrigatórios' });
    }
    const evento = await Evento.create({ nome, descricao, local, data_hora, preco, emoji });
    res.status(201).json({ mensagem: 'Evento criado!', evento });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao criar evento: ' + erro.message });
  }
};

const confirmarPresenca = async (req, res) => {
  try {
    const { evento_id } = req.params;
    const existente = await EventoConfirmacao.findOne({
      where: { evento_id, usuario_id: req.usuarioId }
    });
    let confirmado;
    if (existente) {
      await existente.destroy();
      confirmado = false;
    } else {
      await EventoConfirmacao.create({ evento_id, usuario_id: req.usuarioId });
      confirmado = true;
    }
    const total = await EventoConfirmacao.count({ where: { evento_id } });
    res.json({ mensagem: confirmado ? 'Presença confirmada!' : 'Presença cancelada', confirmado, confirmados: total });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao confirmar presença: ' + erro.message });
  }
};

module.exports = { listarEventos, criarEvento, confirmarPresenca };
