const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const StatusResposta = sequelize.define('StatusResposta', {
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
  conteudo_texto: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  media_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pergunta_texto: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expira_em: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'status_respostas',
  timestamps: true
});

module.exports = StatusResposta;
