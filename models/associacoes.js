/**
 * Associações do Programa de Parceiros.
 *
 * Até aqui o projeto não declarava NENHUMA associação Sequelize — todos os
 * models eram independentes e os relacionamentos eram resolvidos à mão nos
 * controllers (findByPk do usuário depois de buscar o status, por exemplo).
 * Este arquivo é o primeiro a declarar relações, e concentra todas num lugar
 * só de propósito: definir associação dentro de cada model criaria require
 * circular (Parceiro precisa de Usuario, Usuario precisa de Parceiro).
 *
 * Chamar registrarAssociacoes() uma vez na subida do servidor, ANTES do
 * sequelize.sync(). Declarar associação não altera nada no banco por si só —
 * ela habilita include/eager loading e faz o Sequelize conhecer as FKs.
 * As constraints reais no banco vêm do SQL manual (ver PROGRAMA_PARCEIROS.sql),
 * já que produção roda sync() sem alter.
 */
const Usuario = require('./Usuario');
const Parceiro = require('./Parceiro');
const Indicacao = require('./Indicacao');
const Comissao = require('./Comissao');
const BonusMeta = require('./BonusMeta');

let jaRegistrado = false;

function registrarAssociacoes() {
  // Idempotente: chamar duas vezes redefiniria as mesmas associações e o
  // Sequelize passaria a gerar aliases duplicados.
  if (jaRegistrado) return;
  jaRegistrado = true;

  // ===== Parceiro <-> Usuario (a conta dona do parceiro) =====
  Parceiro.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  Usuario.hasOne(Parceiro, { foreignKey: 'usuario_id', as: 'parceiro' });

  // ===== Indicacao =====
  Indicacao.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(Indicacao, { foreignKey: 'parceiro_id', as: 'indicacoes' });

  Indicacao.belongsTo(Usuario, { foreignKey: 'usuario_indicado_id', as: 'usuarioIndicado' });
  Usuario.hasOne(Indicacao, { foreignKey: 'usuario_indicado_id', as: 'indicacaoRecebida' });

  // ===== Comissao =====
  Comissao.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(Comissao, { foreignKey: 'parceiro_id', as: 'comissoes' });

  Comissao.belongsTo(Indicacao, { foreignKey: 'indicacao_id', as: 'indicacao' });
  Indicacao.hasMany(Comissao, { foreignKey: 'indicacao_id', as: 'comissoes' });

  // ===== BonusMeta =====
  BonusMeta.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(BonusMeta, { foreignKey: 'parceiro_id', as: 'bonusMetas' });

  // ===== Usuario -> parceiro que o indicou =====
  // Alias diferente de 'parceiro' (que é o parceiro QUE O USUÁRIO É):
  // 'parceiroIndicador' é o parceiro que TROUXE este usuário. São coisas
  // distintas e um mesmo usuário pode ter as duas.
  Usuario.belongsTo(Parceiro, { foreignKey: 'indicado_por_parceiro_id', as: 'parceiroIndicador' });
  Parceiro.hasMany(Usuario, { foreignKey: 'indicado_por_parceiro_id', as: 'usuariosIndicados' });
}

module.exports = { registrarAssociacoes };
