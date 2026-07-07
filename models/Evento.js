const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Evento = sequelize.define('Evento', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descricao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  local: {
    type: DataTypes.STRING,
    allowNull: false
  },
  data_hora: {
    type: DataTypes.DATE,
    allowNull: false
  },
  preco: {
    type: DataTypes.STRING,
    defaultValue: 'Gratis'
  },
  emoji: {
    type: DataTypes.STRING,
    defaultValue: '🎉'
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'eventos',
  timestamps: true
});

module.exports = Evento;
