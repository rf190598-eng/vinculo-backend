const jwt = require('jsonwebtoken');
const TokenRevogado = require('../models/TokenRevogado');
const Usuario = require('../models/Usuario');

const autenticar = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Correção do achado IMPORTANTE da auditoria (sem logout/revogação de
    // JWT): tokens emitidos a partir de agora carregam um jti. Se o dono já
    // fez logout com este token, o jti está na blacklist e a sessão é
    // rejeitada mesmo com assinatura/expiração válidas. Tokens antigos (sem
    // jti) não passam por esta checagem — não têm como ser revogados
    // individualmente, só expiram sozinhos.
    if (decoded.jti) {
      const revogado = await TokenRevogado.findByPk(decoded.jti);
      if (revogado) {
        return res.status(401).json({ erro: 'Sessão encerrada. Faça login novamente.' });
      }
    }

    // Suspensão administrativa (Lote 3): checada em TODA requisição
    // autenticada, não só no login — assim uma suspensão aplicada agora já
    // barra imediatamente quem já estava logado, sem precisar esperar o
    // token expirar (revogar a sessão especificamente é uma ação separada,
    // ainda não construída). Busca só as 3 colunas necessárias, mesmo
    // padrão de custo mínimo já usado em verificarAdmin.
    const usuario = await Usuario.findByPk(decoded.id, {
      attributes: ['id', 'suspenso_ate', 'suspenso_permanente']
    });
    if (!usuario) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
    if (usuario.suspenso_permanente) {
      return res.status(403).json({ erro: 'Esta conta foi banida.' });
    }
    if (usuario.suspenso_ate && new Date(usuario.suspenso_ate) > new Date()) {
      return res.status(403).json({
        erro: `Esta conta está suspensa até ${new Date(usuario.suspenso_ate).toLocaleDateString('pt-BR')}.`
      });
    }

    req.usuarioId = decoded.id;
    req.usuarioEmail = decoded.email;
    req.tokenJti = decoded.jti;
    req.tokenExp = decoded.exp;

    next();
  } catch (erro) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

module.exports = { autenticar };
