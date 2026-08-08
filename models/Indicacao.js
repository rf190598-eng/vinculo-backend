const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Vínculo entre um parceiro e um usuário que ele trouxe. É a partir daqui que
// as comissões recorrentes são geradas, mês a mês, enquanto o status permitir.
const Indicacao = sequelize.define('Indicacao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  parceiro_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usuario_indicado_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // 'ativo' | 'cancelado' | 'inadimplente'
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ativo'
  },
  // 'semanal' | 'mensal' | 'anual' — null enquanto o indicado não assinar.
  plano_atual: {
    type: DataTypes.STRING,
    allowNull: true
  },
  data_indicacao: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  data_cancelamento: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'indicacoes',
  timestamps: true
});

module.exports = Indicacao;
