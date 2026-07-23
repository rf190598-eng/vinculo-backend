const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const DuplaAvaliacao = sequelize.define('DuplaAvaliacao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  dupla_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  avaliado_dupla_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'dupla_avaliacoes',
  timestamps: true
});

module.exports = DuplaAvaliacao;
