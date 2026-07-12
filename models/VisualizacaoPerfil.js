const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const VisualizacaoPerfil = sequelize.define('VisualizacaoPerfil', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_visto_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usuario_visitante_id: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'visualizacoes_perfil',
  timestamps: true
});

module.exports = VisualizacaoPerfil;
