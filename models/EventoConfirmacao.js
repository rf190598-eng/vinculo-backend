const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const EventoConfirmacao = sequelize.define('EventoConfirmacao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  evento_id: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'eventos_confirmacoes',
  timestamps: true
});

module.exports = EventoConfirmacao;
