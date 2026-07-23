const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Denuncia = sequelize.define('Denuncia', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  denunciante_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  denunciado_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  motivo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  descricao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pendente'
  },
  observacao_admin: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'denuncias',
  timestamps: true
});

module.exports = Denuncia;