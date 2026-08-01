const SolicitacaoParceria = require('../models/SolicitacaoParceria');
const Usuario = require('../models/Usuario');

const criarSolicitacao = async (req, res) => {
  try {
    const {
      nome_espaco, tipo_negocio, endereco, bairro, telefone, instagram,
      descricao, funcionamento, horario, valor_entrada, tipo_anuncio
    } = req.body;

    if (!nome_espaco || !telefone) {
      return res.status(400).json({ erro: 'Nome do espaço e telefone são obrigatórios' });
    }

    const solicitacao = await SolicitacaoParceria.create({
      usuario_id: req.usuarioId,
      nome_espaco, tipo_negocio, endereco, bairro, telefone, instagram,
      descricao, funcionamento, horario, valor_entrada,
      tipo_anuncio: tipo_anuncio || 'gratis'
    });

    res.status(201).json({ mensagem: 'Cadastro enviado! Nossa equipe entrará em contato em até 24h.', solicitacao });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao enviar cadastro: ' + erro.message });
  }
};

const listarSolicitacoes = async (req, res) => {
  try {
    const solicitacoes = await SolicitacaoParceria.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ solicitacoes });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar solicitações: ' + erro.message });
  }
};

module.exports = { criarSolicitacao, listarSolicitacoes };
