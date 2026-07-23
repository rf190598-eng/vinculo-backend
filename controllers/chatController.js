const Mensagem = require('../models/Mensagem');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');

const enviarMensagem = async (req, res) => {
  try {
    const { match_id, conteudo } = req.body;
    const remetente_id = req.usuarioId;
    const match = await Match.findOne({ where: { id: match_id, ativo: true } });
    if (!match) return res.status(403).json({ erro: 'Match nao encontrado' });

    const mensagem = await Mensagem.create({ match_id, remetente_id, conteudo });

    const destinatario_id = match.usuario1_id === remetente_id ? match.usuario2_id : match.usuario1_id;
    const remetente = await Usuario.findByPk(remetente_id);
    await Notificacao.create({
      usuario_id: destinatario_id,
      tipo: 'mensagem',
      texto: `${remetente.nome} te mandou uma mensagem!`
    });

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
