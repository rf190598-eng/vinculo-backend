const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const SolicitacaoParceria = sequelize.define('SolicitacaoParceria', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  nome_espaco: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tipo_negocio: {
    type: DataTypes.STRING,
    allowNull: true
  },
  endereco: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bairro: {
    type: DataTypes.STRING,
    allowNull: true
  },
  telefone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  instagram: {
    type: DataTypes.STRING,
    allowNull: true
  },
  descricao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  funcionamento: {
    type: DataTypes.STRING,
    allowNull: true
  },
  horario: {
    type: DataTypes.STRING,
    allowNull: true
  },
  valor_entrada: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tipo_anuncio: {
    type: DataTypes.STRING,
    defaultValue: 'gratis'
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pendente'
  }
}, {
  tableName: 'solicitacoes_parceria',
  timestamps: true
});

module.exports = SolicitacaoParceria;
