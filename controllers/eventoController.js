const Evento = require('../models/Evento');
const EventoConfirmacao = require('../models/EventoConfirmacao');
const Usuario = require('../models/Usuario');

// Mesmo padrão já usado em perfilController/duplaController (achado IMPORTANTE
// da auditoria, 5.1: nome/local/preço de Evento eram gravados sem sanitizar).
const removerTagsHtml = (texto) => String(texto).replace(/<[^>]*>/g, '').trim();

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
    const { nome, descricao, local, data_hora, preco, emoji } = req.body;
    if (!nome || !local || !data_hora) {
      return res.status(400).json({ erro: 'Nome, local e data são obrigatórios' });
    }
    // nome/local/preco só são exibidos escapados no admin (admin-painel.html já
    // usa esc()); o risco real é no prototipo.html, consumido por qualquer
    // usuário comum via innerHTML sem escape (ver correção do lado do cliente).
    // descricao não é renderizada em nenhum lugar hoje, mas sanitizada por
    // consistência — mesmo padrão do resto do app (defesa em profundidade).
    // preco/descricao só são sanitizados quando enviados — omitidos, mantêm o
    // defaultValue/allowNull do model.
    const evento = await Evento.create({
      nome: removerTagsHtml(nome),
      descricao: descricao !== undefined ? removerTagsHtml(descricao) : descricao,
      local: removerTagsHtml(local),
      data_hora,
      preco: preco !== undefined ? removerTagsHtml(preco) : preco,
      emoji
    });
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
