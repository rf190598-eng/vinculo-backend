const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Uma linha por mês de referência por indicação. O par
// (indicacao_id, mes_referencia) é o que impede pagar duas vezes o mesmo mês —
// ver o índice único sugerido no SQL de criação.
const Comissao = sequelize.define('Comissao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  parceiro_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  indicacao_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // DATEONLY: o mês de competência não tem hora, e guardar com timestamp
  // criaria ambiguidade de fuso na virada do mês.
  mes_referencia: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  // 'pendente' | 'pago'
  status_pagamento: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pendente'
  },
  data_pagamento: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'comissoes',
  timestamps: true
});

module.exports = Comissao;
