const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Dupla = sequelize.define('Dupla', {
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
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pendente'
  },
  bio_conjunta: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'duplas',
  timestamps: true
});

module.exports = Dupla;
