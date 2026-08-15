const jwt = require('jsonwebtoken');
const TokenRevogado = require('../models/TokenRevogado');

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
