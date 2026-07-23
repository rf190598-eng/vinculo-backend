const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const AlertaSeguranca = sequelize.define('AlertaSeguranca', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  latitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  longitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  mensagens_simuladas: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'alertas_seguranca',
  timestamps: true
});

module.exports = AlertaSeguranca;
