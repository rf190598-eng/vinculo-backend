const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Meta de bônus atribuída a um parceiro: trazer N usuários em X dias rende um
// valor extra. Guarda o alvo e o resultado, não o progresso — a contagem atual
// sai de indicacoes, pra não existirem dois lugares dizendo quantos são.
const BonusMeta = sequelize.define('BonusMeta', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  parceiro_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  meta_usuarios: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  prazo_dias: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  data_inicio: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  valor_bonus: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  atingida: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  data_atingida: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'bonus_metas',
  timestamps: true
});

module.exports = BonusMeta;
