const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Mensagem = sequelize.define('Mensagem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  match_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  remetente_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  conteudo: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  lida: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'mensagens',
  timestamps: true
});

module.exports = Mensagem; 
