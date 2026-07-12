const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const AvaliacaoEncontro = sequelize.define('AvaliacaoEncontro', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessao_seguranca_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  nota: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  comentario: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'avaliacoes_encontro',
  timestamps: true
});

module.exports = AvaliacaoEncontro;
