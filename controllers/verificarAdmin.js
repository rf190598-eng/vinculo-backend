const Usuario = require('../models/Usuario');

const verificarAdmin = async (req, res, next) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId);

    if (!usuario || !usuario.is_admin) {
      return res.status(403).json({ erro: 'Acesso restrito a administradores' });
    }

    // Disponibiliza a identidade do admin logado pras rotas administrativas
    // seguintes — usado pelo log de auditoria (registrarLogAuditoria) pra
    // saber quem fez a ação, sem cada controller precisar buscar o Usuario
    // de novo.
    req.usuarioAdmin = usuario;

    next();
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar permissão: ' + erro.message });
  }
};

module.exports = { verificarAdmin };