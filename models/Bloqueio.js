const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Bloqueio = sequelize.define('Bloqueio', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  bloqueado_id: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'bloqueios',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['usuario_id', 'bloqueado_id']
    }
  ]
});

module.exports = Bloqueio;