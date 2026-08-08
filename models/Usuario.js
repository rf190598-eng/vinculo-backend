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
  estilo_vida: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  interesses: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
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
  // Caminho da imagem de referência capturada durante o Face Liveness (antes de
  // existir foto de perfil). Usada uma única vez, pra comparar com a primeira
  // foto de perfil que o usuário definir (ver perfilController.uploadFoto).
  foto_referencia_liveness: {
    type: DataTypes.STRING,
    allowNull: true
  },
  verificado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  liveness_aprovado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  liveness_confianca: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  premium: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  premium_ate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Plano pago ATUALMENTE ativo: 'semanal' | 'mensal' | 'anual', ou null se
  // não há assinatura vigente. Diferente de `premium`, que hoje vem true por
  // padrão na fase gratuita — este campo só é preenchido por pagamento
  // confirmado, e é ele que define se uma indicação conta como ativa no
  // Programa de Parceiros.
  plano_atual: {
    type: DataTypes.STRING,
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
  instagram_handle: {
    type: DataTypes.STRING,
    allowNull: true
  },
  prompts: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
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
  pref_apenas_verificados: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pref_objetivo: {
    type: DataTypes.STRING,
    allowNull: true
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
  },
  // Programa de Parceiros: qual parceiro trouxe este usuário. Capturado no
  // cadastro (a partir do codigo_indicacao do link) e imutável depois — é a
  // base de quem recebe comissão recorrente por esta conta.
  // Não confundir com os campos codigo_indicacao/indicado_por já existentes,
  // que são do programa de indicação ENTRE USUÁRIOS (usuário convida amigo) e
  // seguem funcionando de forma independente.
  indicado_por_parceiro_id: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'usuarios',
  timestamps: true
});
module.exports = Usuario;
