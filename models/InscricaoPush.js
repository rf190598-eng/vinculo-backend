const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Uma linha por inscrição de push de um dispositivo/navegador específico —
// um mesmo usuário pode ter várias (celular + desktop, por exemplo).
// endpoint é único: identifica de forma exclusiva aquele navegador/instalação
// junto ao serviço de push (FCM, Mozilla push, Apple), e é reaproveitado
// como chave de upsert manual em pushController.inscrever (ver comentário lá).
const InscricaoPush = sequelize.define('InscricaoPush', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  endpoint: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true
  },
  p256dh: {
    type: DataTypes.STRING,
    allowNull: false
  },
  auth: {
    type: DataTypes.STRING,
    allowNull: false
  },
  user_agent: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'inscricoes_push',
  timestamps: true,
  indexes: [
    { fields: ['usuario_id'] }
  ]
});

module.exports = InscricaoPush;
