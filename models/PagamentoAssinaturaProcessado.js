const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Registro de idempotência: uma linha por pagamento de ciclo de assinatura
// já processado. mercadopago_payment_id é a chave que impede processar o
// mesmo pagamento duas vezes (ver fatia1-webhooks-resultado.md — não usar
// subscription_sequence.number como chave, porque cobrança recusada e
// retentada gera IDs de pagamento diferentes para o MESMO ciclo).
//
// Padrão de uso pretendido (Fatia 5): fazer o INSERT direto e tratar
// violação de unicidade em mercadopago_payment_id como "já processado,
// ignora" — em vez de "consultar se existe, depois inserir", que tem uma
// brecha de corrida se dois webhooks do mesmo pagamento chegarem juntos.
const PagamentoAssinaturaProcessado = sequelize.define('PagamentoAssinaturaProcessado', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  mercadopago_payment_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  mercadopago_subscription_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // subscription_sequence.number do payload — dado de auditoria/detecção de
  // lacunas, NÃO a chave de dedup (ver comentário acima).
  numero_ciclo: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  processado_em: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'pagamentos_assinatura_processados',
  timestamps: false
});

module.exports = PagamentoAssinaturaProcessado;
