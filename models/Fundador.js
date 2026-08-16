const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Comunidade de Fundadores do Vínculo: pré-cadastro público, sem relação
// nenhuma com o model Usuario (sem senha, sem liveness, sem nada de app —
// a pessoa ainda não é usuária, só está entrando na comunidade do WhatsApp
// antes do lançamento).
const Fundador = sequelize.define('Fundador', {
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
  telefone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  genero: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // Gera o link pessoal dela: vinculoapp.com.br/fundadores/CODIGO
  codigo_proprio: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  // Código de quem indicou (codigo_proprio de outro Fundador), null se veio
  // direto. Mesmo padrão de codigo_indicacao/indicado_por já usado em
  // Usuario — por valor, não FK, pra um código inválido nunca travar o
  // cadastro.
  codigo_indicador: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'fundadores',
  timestamps: true
});

module.exports = Fundador;
