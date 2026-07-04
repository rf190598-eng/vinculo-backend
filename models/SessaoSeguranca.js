const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const SessaoSeguranca = sequelize.define('SessaoSeguranca', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  ativa: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  prazo_confirmacao: {
    type: DataTypes.DATE,
    allowNull: true
  },
  alerta_disparado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ultima_lat: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  ultima_lng: {
    type: DataTypes.FLOAT,
    allowNull: true
  }
}, {
  tableName: 'sessoes_seguranca',
  timestamps: true
});

module.exports = SessaoSeguranca;
