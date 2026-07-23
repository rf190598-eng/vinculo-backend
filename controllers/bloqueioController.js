const Bloqueio = require('../models/Bloqueio');

const bloquearUsuario = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { bloqueado_id } = req.body;

    if (!bloqueado_id) {
      return res.status(400).json({ erro: 'Informe o usuário a bloquear' });
    }
    if (bloqueado_id === usuario_id) {
      return res.status(400).json({ erro: 'Não é possível bloquear seu próprio perfil' });
    }

    const [bloqueio, criado] = await Bloqueio.findOrCreate({
      where: { usuario_id, bloqueado_id }
    });

    res.status(201).json({
      mensagem: criado ? 'Usuário bloqueado com sucesso' : 'Usuário já estava bloqueado',
      bloqueio
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao bloquear usuário: ' + erro.message });
  }
};

const desbloquearUsuario = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { bloqueado_id } = req.params;

    await Bloqueio.destroy({ where: { usuario_id, bloqueado_id } });
    res.json({ mensagem: 'Usuário desbloqueado' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao desbloquear usuário: ' + erro.message });
  }
};

const listarBloqueados = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const bloqueios = await Bloqueio.findAll({ where: { usuario_id } });
    res.json({ bloqueios });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar bloqueios: ' + erro.message });
  }
};

module.exports = { bloquearUsuario, desbloquearUsuario, listarBloqueados };