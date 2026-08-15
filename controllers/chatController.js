const Mensagem = require('../models/Mensagem');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const Bloqueio = require('../models/Bloqueio');
const { Op } = require('sequelize');

// Correção do achado IMPORTANTE da auditoria: bloqueio impedia swipe/perfil
// mas não cortava o chat de um match já existente. Checado em enviarMensagem
// E listarMensagens — nem mandar, nem ler mensagem nova funciona depois que
// qualquer um dos dois bloqueia o outro, dos dois lados.
async function existeBloqueioEntre(idA, idB) {
  const bloqueio = await Bloqueio.findOne({
    where: {
      [Op.or]: [
        { usuario_id: idA, bloqueado_id: idB },
        { usuario_id: idB, bloqueado_id: idA }
      ]
    }
  });
  return !!bloqueio;
}

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

    const destinatario_id = match.usuario1_id === remetente_id ? match.usuario2_id : match.usuario1_id;
    if (await existeBloqueioEntre(remetente_id, destinatario_id)) {
      return res.status(403).json({ erro: 'Não é possível enviar mensagens nesta conversa.' });
    }

    const conteudoLimpo = String(conteudo).replace(/<[^>]*>/g, '').trim().slice(0, 2000);
    const mensagem = await Mensagem.create({ match_id, remetente_id, conteudo: conteudoLimpo });

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

    const outro_id = match.usuario1_id === usuario_id ? match.usuario2_id : match.usuario1_id;
    if (await existeBloqueioEntre(usuario_id, outro_id)) {
      return res.status(403).json({ erro: 'Não é possível acessar esta conversa.' });
    }

    const mensagens = await Mensagem.findAll({ where: { match_id }, order: [['createdAt', 'ASC']] });
    res.json({ mensagens });
  } catch (erro) {
    console.error('Erro ao listar mensagens:', erro);
    res.status(500).json({ erro: 'Não foi possível carregar as mensagens.' });
  }
};

module.exports = { enviarMensagem, listarMensagens };
