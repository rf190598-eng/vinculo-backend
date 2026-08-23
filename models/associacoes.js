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
const PagamentoAssinaturaProcessado = require('./PagamentoAssinaturaProcessado');
const InscricaoPush = require('./InscricaoPush');

let jaRegistrado = false;

function registrarAssociacoes() {
  // Idempotente: chamar duas vezes redefiniria as mesmas associações e o
  // Sequelize passaria a gerar aliases duplicados.
  if (jaRegistrado) return;
  jaRegistrado = true;

  // ===== Parceiro <-> Usuario (a conta dona do parceiro) =====
  // onDelete: 'CASCADE' adicionado aqui depois do incidente em que a FK real
  // no banco (criada por um sync() anterior ao PROGRAMA_PARCEIROS.sql) não
  // tinha CASCADE — bloqueava excluirConta pra qualquer parceiro. Continua
  // sendo só documentação em produção (sync roda sem alter), mas garante que
  // uma instalação NOVA do zero já nasça certa. A correção de verdade do
  // banco existente está em FIX_CASCADE_PARCEIROS.sql.
  Parceiro.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  Usuario.hasOne(Parceiro, { foreignKey: 'usuario_id', as: 'parceiro', onDelete: 'CASCADE' });

  // ===== Indicacao =====
  Indicacao.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(Indicacao, { foreignKey: 'parceiro_id', as: 'indicacoes', onDelete: 'CASCADE' });

  Indicacao.belongsTo(Usuario, { foreignKey: 'usuario_indicado_id', as: 'usuarioIndicado' });
  Usuario.hasOne(Indicacao, { foreignKey: 'usuario_indicado_id', as: 'indicacaoRecebida', onDelete: 'CASCADE' });

  // ===== Comissao =====
  Comissao.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(Comissao, { foreignKey: 'parceiro_id', as: 'comissoes', onDelete: 'CASCADE' });

  Comissao.belongsTo(Indicacao, { foreignKey: 'indicacao_id', as: 'indicacao' });
  Indicacao.hasMany(Comissao, { foreignKey: 'indicacao_id', as: 'comissoes', onDelete: 'CASCADE' });

  // ===== BonusMeta =====
  BonusMeta.belongsTo(Parceiro, { foreignKey: 'parceiro_id', as: 'parceiro' });
  Parceiro.hasMany(BonusMeta, { foreignKey: 'parceiro_id', as: 'bonusMetas', onDelete: 'CASCADE' });

  // Comissão de bônus aponta pra meta que a originou (tipo='bonus_meta').
  Comissao.belongsTo(BonusMeta, { foreignKey: 'bonus_meta_id', as: 'bonusMeta' });
  BonusMeta.hasOne(Comissao, { foreignKey: 'bonus_meta_id', as: 'comissaoBonus' });

  // ===== Usuario -> parceiro que o indicou =====
  // Alias diferente de 'parceiro' (que é o parceiro QUE O USUÁRIO É):
  // 'parceiroIndicador' é o parceiro que TROUXE este usuário. São coisas
  // distintas e um mesmo usuário pode ter as duas.
  Usuario.belongsTo(Parceiro, { foreignKey: 'indicado_por_parceiro_id', as: 'parceiroIndicador' });
  Parceiro.hasMany(Usuario, { foreignKey: 'indicado_por_parceiro_id', as: 'usuariosIndicados' });

  // ===== PagamentoAssinaturaProcessado (cartão recorrente, Fatia 2+) =====
  // Histórico de cobranças de assinatura já processadas para este usuário —
  // ver comentário no model sobre o uso como chave de idempotência.
  // onDelete: 'CASCADE' aqui é só documentação (produção roda sync sem alter,
  // então isto nunca gera DDL) — a constraint real no banco foi corrigida à mão
  // via SQL (ver auditoria de segurança, achado IMPORTANTE sobre a FK que
  // bloqueava excluirConta pra quem já pagou por cartão recorrente).
  PagamentoAssinaturaProcessado.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  Usuario.hasMany(PagamentoAssinaturaProcessado, { foreignKey: 'usuario_id', as: 'pagamentosAssinatura', onDelete: 'CASCADE' });

  // ===== InscricaoPush (Web Push / VAPID) =====
  InscricaoPush.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  Usuario.hasMany(InscricaoPush, { foreignKey: 'usuario_id', as: 'inscricoesPush', onDelete: 'CASCADE' });
}

module.exports = { registrarAssociacoes };
