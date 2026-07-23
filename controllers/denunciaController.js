const Denuncia = require('../models/Denuncia');

const MOTIVOS_VALIDOS = [
  'assedio',
  'perfil_falso',
  'conteudo_impróprio',
  'golpe_financeiro',
  'ameaca',
  'spam',
  'outro'
];

const criarDenuncia = async (req, res) => {
  try {
    const denunciante_id = req.usuarioId;
    const { denunciado_id, motivo, descricao } = req.body;

    if (!denunciado_id || !motivo) {
      return res.status(400).json({ erro: 'Informe o usuário denunciado e o motivo' });
    }
    if (denunciado_id === denunciante_id) {
      return res.status(400).json({ erro: 'Não é possível denunciar seu próprio perfil' });
    }
    if (!MOTIVOS_VALIDOS.includes(motivo)) {
      return res.status(400).json({ erro: 'Motivo inválido' });
    }

    const denuncia = await Denuncia.create({
      denunciante_id,
      denunciado_id,
      motivo,
      descricao: descricao || null
    });

    res.status(201).json({ mensagem: 'Denúncia registrada. Nossa equipe vai analisar.', denuncia });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao registrar denúncia: ' + erro.message });
  }
};

const listarDenuncias = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    const denuncias = await Denuncia.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ denuncias });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar denúncias: ' + erro.message });
  }
};

const atualizarStatusDenuncia = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, observacao_admin } = req.body;

    const statusValidos = ['pendente', 'em_analise', 'resolvida', 'arquivada'];
    if (!statusValidos.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido' });
    }

    await Denuncia.update({ status, observacao_admin }, { where: { id } });
    res.json({ mensagem: 'Denúncia atualizada' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao atualizar denúncia: ' + erro.message });
  }
};

module.exports = { criarDenuncia, listarDenuncias, atualizarStatusDenuncia };