const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Swipe = sequelize.define('Swipe', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  alvo_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tipo: {
    type: DataTypes.ENUM('like', 'dislike', 'superlike'),
    allowNull: false
  }
}, {
  tableName: 'swipes',
  timestamps: true
});

module.exports = Swipe; 
