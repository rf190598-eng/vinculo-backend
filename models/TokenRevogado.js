const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Lista de tokens revogados (JWT "sair") — correção do achado IMPORTANTE da
// auditoria sobre não haver logout/revogação de JWT.
//
// jti (JWT ID) é gerado em cada login/cadastro e viaja dentro do próprio
// token (ver authController.js e googleAuthController.js). Ao fazer logout,
// o jti do token atual entra aqui — authMiddleware passa a rejeitar qualquer
// requisição que chegue com um jti presente nesta tabela, mesmo que a
// assinatura/expiração do JWT continuem válidas.
//
// expira_em é copiado do "exp" do próprio token — depois dessa data o JWT já
// seria rejeitado de qualquer forma (expirado), então a linha vira lixo e é
// apagada pela limpeza periódica em index.js.
//
// Limitação conhecida e aceita: tokens emitidos ANTES desta correção não têm
// jti — não têm como ser revogados individualmente, só expiram sozinhos em
// até 30 dias.
const TokenRevogado = sequelize.define('TokenRevogado', {
  jti: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  expira_em: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'tokens_revogados',
  timestamps: false
});

module.exports = TokenRevogado;
