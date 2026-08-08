const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

// Parceiro do Programa de Parceiros: quem indica novos usuários e recebe
// comissão recorrente enquanto o indicado seguir pagando.
// PK em UUID pra manter o padrão do resto do schema (usuarios,
// status_respostas etc.) e pra não expor volume de parceiros por ID sequencial.
const Parceiro = sequelize.define('Parceiro', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // UUID porque usuarios.id é UUID — não é escolha, é o tipo da coluna referenciada.
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // 'individual' | 'institucional'
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // Vai no link de indicação, então precisa ser único.
  codigo_indicacao: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  // 'ativo' | 'pendente_aprovacao' | 'suspenso'
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ativo'
  },
  // Só faz sentido quando tipo === 'institucional'.
  nome_instituicao: {
    type: DataTypes.STRING,
    allowNull: true
  },
  chave_pix: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Percentual base de comissão. DECIMAL(10,2) em vez de FLOAT: valor
  // monetário/percentual não pode sofrer erro de arredondamento binário.
  comissao_base: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 5.00
  },
  data_aprovacao: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Quem preencheu a solicitação institucional. Pode ser diferente do nome da
  // conta Vínculo (ex: o presidente da atlética solicita pela conta dele, mas
  // o responsável formal é outra pessoa).
  responsavel_solicitacao: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // E-mail informado para contato sobre a parceria — não necessariamente o
  // e-mail de login da conta.
  email_contato_solicitacao: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // APENAS a mensagem/justificativa livre da solicitação.
  // Solicitações antigas (anteriores à separação em colunas) guardam aqui os
  // três dados concatenados no formato
  // "Responsável: X | E-mail de contato: Y | Mensagem: Z" — não foram
  // migradas de propósito, então o painel precisa continuar exibindo esse
  // texto como veio.
  observacao_solicitacao: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'parceiros',
  timestamps: true
});

module.exports = Parceiro;
