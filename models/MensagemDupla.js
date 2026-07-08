const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const MensagemDupla = sequelize.define('MensagemDupla', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  dupla_match_id: {
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
  }
}, {
  tableName: 'mensagens_dupla',
  timestamps: true
});

module.exports = MensagemDupla;
