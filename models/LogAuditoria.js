const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Log de auditoria de ações administrativas sensíveis (Lote 0 do plano de
// acesso total do Painel Central). Não limita o que um admin pode fazer —
// só registra quem fez o quê, quando, e em qual usuário.
//
// admin_nome/admin_email e usuario_alvo_nome/usuario_alvo_email são cópias
// congeladas no momento da ação (não referências vivas), de propósito:
// contaController.excluirConta faz exclusão real em cascata, então se o
// log dependesse de uma FK/join com o Usuario ainda existente, perderia o
// rastro justamente na ação mais grave (excluir conta de alguém).
// usuario_alvo_id fica nullable pelo mesmo motivo.
//
// detalhes é um JSONB livre — guarda o que for específico de cada ação
// (campo alterado e valores antes/depois numa edição de perfil, duração de
// uma suspensão, motivo digitado pelo admin, etc.) sem precisar de coluna
// nova por tipo de ação.
const LogAuditoria = sequelize.define('LogAuditoria', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  admin_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  admin_nome: {
    type: DataTypes.STRING,
    allowNull: false
  },
  admin_email: {
    type: DataTypes.STRING,
    allowNull: false
  },
  acao: {
    type: DataTypes.STRING,
    allowNull: false
  },
  usuario_alvo_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  usuario_alvo_nome: {
    type: DataTypes.STRING,
    allowNull: true
  },
  usuario_alvo_email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  detalhes: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  tableName: 'logs_auditoria',
  timestamps: true
});

module.exports = LogAuditoria;
