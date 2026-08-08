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
  // 'recorrente' = R$/mês por indicação ativa. 'bonus_meta' = pagamento único
  // de uma meta batida. Os dois moram na MESMA tabela de propósito: o painel
  // admin, o total a pagar e o "marcar como pago" já funcionam sobre
  // comissoes — uma tabela separada só para bônus obrigaria a duplicar todo
  // esse fluxo de pagamento.
  tipo: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'recorrente'
  },
  // NULL quando tipo='bonus_meta': bônus é do parceiro, não de uma indicação
  // específica. Por isso a coluna deixou de ser obrigatória.
  indicacao_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  // Preenchido só em tipo='bonus_meta'. Um índice único parcial no banco
  // garante que a mesma meta nunca gere dois pagamentos.
  bonus_meta_id: {
    type: DataTypes.UUID,
    allowNull: true
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
