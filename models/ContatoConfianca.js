const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const ContatoConfianca = sequelize.define('ContatoConfianca', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false
  },
  telefone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  parentesco: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'contatos_confianca',
  timestamps: true
});

module.exports = ContatoConfianca;
