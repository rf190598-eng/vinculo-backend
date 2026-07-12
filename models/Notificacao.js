const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Notificacao = sequelize.define('Notificacao', {
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
  texto: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lida: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'notificacoes',
  timestamps: true
});

module.exports = Notificacao;
