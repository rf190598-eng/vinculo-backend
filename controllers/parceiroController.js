const { Op, fn, col } = require('sequelize');
const Usuario = require('../models/Usuario');
const Parceiro = require('../models/Parceiro');
const Indicacao = require('../models/Indicacao');
const Comissao = require('../models/Comissao');

// Base do link curto de parceiro. Configurável por env porque o domínio final
// pode mudar antes do lançamento — e o link vai impresso/compartilhado por aí,
// então não pode depender de hardcode espalhado.
const LINK_BASE_PARCEIRO = process.env.APP_LINK_BASE || 'https://app.vinculoapp.com.br';

// Valor pago por indicado ativo, por mês. Espelha o default de comissao_base
// no model Parceiro — cada parceiro pode ter o seu próprio valor negociado.
const COMISSAO_PADRAO = 5.00;

// Gera código do parceiro. Mesma ideia da geração de codigo_indicacao em
// usuarios, mas propositalmente SEPARADA: são sistemas diferentes (o de
// usuarios é usado pelas Duplas) e os códigos não devem colidir nem ser
// confundidos. O prefixo 'p' deixa a origem óbvia em logs e suporte.
function gerarCodigoParceiro(nome) {
  // normalize('NFD') decompõe acentos (é -> e + marca de combinação) e o
  // filtro [^a-z] logo abaixo remove as marcas junto com o resto — por isso
  // não precisa de um replace separado pro range de diacríticos.
  const base = (nome || 'parceiro')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '')
    .slice(0, 8) || 'parceiro';
  const numero = Math.floor(1000 + Math.random() * 9000);
  return 'p' + base + numero;
}

async function gerarCodigoParceiroUnico(nome) {
  let codigo = gerarCodigoParceiro(nome);
  let tentativas = 0;
  while (await Parceiro.findOne({ where: { codigo_indicacao: codigo } }) && tentativas < 5) {
    codigo = gerarCodigoParceiro(nome);
    tentativas++;
  }
  return codigo;
}

// Primeiro dia do mês corrente, no formato que a coluna DATEONLY espera.
function primeiroDiaDoMes() {
  const agora = new Date();
  const primeiro = new Date(agora.getFullYear(), agora.getMonth(), 1);
  return primeiro.toISOString().slice(0, 10);
}

function somaDecimal(valor) {
  // SUM de DECIMAL volta como string no pg (pra não perder precisão em
  // números grandes). Converter aqui evita "0.00" virar string no JSON.
  return Number(valor || 0);
}

/**
 * GET /api/parceiros/me
 *
 * Auto-provisiona: qualquer usuário autenticado que abrir a tela vira parceiro
 * na hora, sem etapa de cadastro. Foi decidido assim porque o programa é aberto
 * a todos — se um dia passar a exigir aprovação, basta criar com
 * status 'pendente_aprovacao' aqui.
 */
const meuParceiro = async (req, res) => {
  try {
    let parceiro = await Parceiro.findOne({ where: { usuario_id: req.usuarioId } });

    if (!parceiro) {
      const usuario = await Usuario.findByPk(req.usuarioId, { attributes: ['id', 'nome'] });
      if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

      const codigo = await gerarCodigoParceiroUnico(usuario.nome);
      try {
        parceiro = await Parceiro.create({
          usuario_id: req.usuarioId,
          tipo: 'individual',
          codigo_indicacao: codigo,
          status: 'ativo',
          comissao_base: COMISSAO_PADRAO
        });
      } catch (erroCriacao) {
        // Corrida: duas abas abrindo a tela ao mesmo tempo. O índice único
        // (usuario_id não é único, mas codigo_indicacao é) pode estourar —
        // nesse caso o registro do outro request já existe, então relemos.
        if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
          parceiro = await Parceiro.findOne({ where: { usuario_id: req.usuarioId } });
        }
        if (!parceiro) throw erroCriacao;
      }
    }

    const [totalIndicacoes, indicacoesAtivas, ganhoTotal, ganhoMes] = await Promise.all([
      Indicacao.count({ where: { parceiro_id: parceiro.id } }),
      Indicacao.count({ where: { parceiro_id: parceiro.id, status: 'ativo' } }),
      // Todas as comissões já geradas, independente de status_pagamento —
      // é o "acumulado histórico", não o "já recebido".
      Comissao.sum('valor', { where: { parceiro_id: parceiro.id } }),
      Comissao.sum('valor', {
        where: { parceiro_id: parceiro.id, mes_referencia: primeiroDiaDoMes() }
      })
    ]);

    const comissaoBase = somaDecimal(parceiro.comissao_base) || COMISSAO_PADRAO;

    res.json({
      codigo_indicacao: parceiro.codigo_indicacao,
      link: `${LINK_BASE_PARCEIRO}/r/${parceiro.codigo_indicacao}`,
      tipo: parceiro.tipo,
      status: parceiro.status,
      comissao_base: comissaoBase,

      total_indicacoes: totalIndicacoes,
      indicacoes_ativas: indicacoesAtivas,

      // Reais, vindos da tabela comissoes. Enquanto o fechamento mensal
      // automático não existir (próxima etapa), vêm zerados.
      ganho_total: somaDecimal(ganhoTotal),
      ganho_mes_atual: somaDecimal(ganhoMes),

      // Projeção do mês corrente a partir dos indicados ativos. NÃO é dinheiro
      // gerado — é o que o mês renderia se todos seguirem ativos até o
      // fechamento. Separado dos campos acima de propósito, pra não misturar
      // estimativa com valor apurado.
      ganho_mes_estimado: Number((indicacoesAtivas * comissaoBase).toFixed(2))
    });
  } catch (erro) {
    console.error('Erro em meuParceiro:', erro);
    res.status(500).json({ erro: 'Erro ao carregar seus dados de parceiro: ' + erro.message });
  }
};

/**
 * Cria a linha em "indicacoes" quando o usuário indicado confirma identidade.
 * Chamada pelo perfilController no mesmo ponto onde ficava o bônus antigo.
 *
 * Idempotente: se já existe indicação para esse usuário, não faz nada. Isso
 * também é garantido no banco pelo índice único uq_indicacoes_usuario_indicado.
 */
async function registrarIndicacaoSeAplicavel(usuarioVerificado) {
  if (!usuarioVerificado || !usuarioVerificado.indicado_por_parceiro_id) return null;

  const jaExiste = await Indicacao.findOne({
    where: { usuario_indicado_id: usuarioVerificado.id }
  });
  if (jaExiste) return jaExiste;

  const parceiro = await Parceiro.findByPk(usuarioVerificado.indicado_por_parceiro_id);
  if (!parceiro) return null;

  try {
    return await Indicacao.create({
      parceiro_id: parceiro.id,
      usuario_indicado_id: usuarioVerificado.id,
      status: 'ativo',
      // usuarios não tem coluna de plano — o plano só existe no metadata do
      // Mercado Pago e vira premium_ate. Fica null aqui e será preenchido
      // quando a integração com status de assinatura for feita (próxima etapa).
      plano_atual: null,
      data_indicacao: new Date()
    });
  } catch (erroCriacao) {
    // Corrida entre dois requests de verificação: o índice único resolve,
    // e aqui só evitamos derrubar o upload da foto por causa disso.
    if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
      return await Indicacao.findOne({ where: { usuario_indicado_id: usuarioVerificado.id } });
    }
    throw erroCriacao;
  }
}

/**
 * Resolve um código de parceiro para o id, usado no cadastro.
 * Retorna null se o código não existir ou o parceiro não estiver ativo —
 * assim um código de parceiro suspenso não gera indicação nova.
 */
async function resolverParceiroPorCodigo(codigo) {
  if (!codigo) return null;
  const parceiro = await Parceiro.findOne({
    where: { codigo_indicacao: String(codigo).trim(), status: 'ativo' }
  });
  return parceiro ? parceiro.id : null;
}

module.exports = {
  meuParceiro,
  registrarIndicacaoSeAplicavel,
  resolverParceiroPorCodigo,
  LINK_BASE_PARCEIRO
};
