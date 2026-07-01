const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Match = sequelize.define('Match', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario1_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usuario2_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'matches',
  timestamps: true
});

module.exports = Match; 
