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
  },
  signo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  foto_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  foto_verificacao: {
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
  codigo_indicacao: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  indicado_por: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bonus_indicacao_creditado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  altura: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  peso: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  cor_cabelo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pref_genero: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pref_idade_min: {
    type: DataTypes.INTEGER,
    defaultValue: 18
  },
  pref_idade_max: {
    type: DataTypes.INTEGER,
    defaultValue: 99
  },
  pref_distancia_km: {
    type: DataTypes.INTEGER,
    defaultValue: 50
  },
  pref_altura_min: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pref_altura_max: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pref_peso_min: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pref_peso_max: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pref_cor_cabelo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  reset_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reset_token_expira: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_admin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'usuarios',
  timestamps: true
});
module.exports = Usuario;