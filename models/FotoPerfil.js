const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const FotoPerfil = sequelize.define('FotoPerfil', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ordem: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'fotos_perfil',
  timestamps: true
});

module.exports = FotoPerfil;
