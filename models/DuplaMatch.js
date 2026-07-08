const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const DuplaMatch = sequelize.define('DuplaMatch', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  dupla1_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  dupla2_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'dupla_matches',
  timestamps: true
});

module.exports = DuplaMatch;
