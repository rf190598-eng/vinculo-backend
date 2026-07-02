const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  senha: {
    type: DataTypes.STRING,
    allowNull: false
  },
  data_nascimento: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
 
genero: {
    type: DataTypes.STRING,
    allowNull: true
  },
  objetivo: {
    type: DataTypes.STRING,
    allowNull: true
  },  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  foto_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  verificado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  premium: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  premium_ate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  latitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  longitude: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  cidade: {
    type: DataTypes.STRING,
    defaultValue: 'São José do Rio Preto'
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'usuarios',
  timestamps: true
});

module.exports = Usuario; 
