const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Guarda um contador por mês (ex: "2026-07") de quantas comparações faciais
// já foram feitas via AWS Rekognition, pra nunca ultrapassar o limite gratuito.
const UsoRekognition = sequelize.define('UsoRekognition', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  mes_referencia: {
    type: DataTypes.STRING, // formato "AAAA-MM"
    allowNull: false,
    unique: true
  },
  quantidade: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'uso_rekognition',
  timestamps: true
});

module.exports = UsoRekognition;
