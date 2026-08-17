const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Ledger unificado de TODO pagamento aprovado (Pix avulso + cartão
// recorrente), alimentado pelo webhook do Mercado Pago nos dois ramos.
// Separado de PagamentoAssinaturaProcessado (que continua só pra cartão,
// com os campos de ciclo/assinatura) porque o propósito aqui é outro: dar
// ao painel financeiro uma visão de receita real, com os dois métodos
// juntos, num formato simples de somar/agrupar.
//
// mercadopago_payment_id é a chave de dedup — mesmo padrão de
// PagamentoAssinaturaProcessado: INSERT direto, violação de unicidade =
// "já processado, ignora".
//
// Só existe a partir de quando esta tabela foi criada — pagamentos
// anteriores não aparecem aqui retroativamente.
const PagamentoProcessado = sequelize.define('PagamentoProcessado', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  metodo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  plano: {
    type: DataTypes.STRING,
    allowNull: false
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  mercadopago_payment_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  processado_em: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'pagamentos_processados',
  timestamps: false
});

module.exports = PagamentoProcessado;
