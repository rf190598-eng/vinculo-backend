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
 * Ponto ÚNICO de verdade da relação "usuário pagante <-> indicação ativa".
 *
 * Regra: a indicação só existe e só fica 'ativo' enquanto o indicado tem
 * plano_atual preenchido — ou seja, assinatura paga vigente. Verificar
 * identidade não basta (era o comportamento anterior, e inflava a base de
 * indicados ativos com gente que nunca pagou).
 *
 * Chamada de três lugares, sempre com o mesmo efeito:
 *  - perfilController, quando a identidade é confirmada
 *  - pagamentoController, quando um pagamento é aprovado ou expira
 *  - job diário de vencimento (assinaturaJob)
 *
 * Idempotente: pode rodar quantas vezes for, o resultado é o mesmo.
 */
async function sincronizarIndicacaoDoUsuario(usuarioOuId) {
  const usuario = typeof usuarioOuId === 'string'
    ? await Usuario.findByPk(usuarioOuId)
    : usuarioOuId;

  if (!usuario || !usuario.indicado_por_parceiro_id) return null;

  const estaPagando = !!usuario.plano_atual;
  const indicacao = await Indicacao.findOne({
    where: { usuario_indicado_id: usuario.id }
  });

  // ---- Não está pagando ----
  if (!estaPagando) {
    // Nunca existiu indicação: não cria nada. A indicação só nasce no primeiro
    // pagamento confirmado, nunca na verificação de identidade.
    if (!indicacao) return null;

    // Existia e estava ativa: virou cancelamento (assinatura acabou).
    if (indicacao.status === 'ativo') {
      await indicacao.update({
        status: 'cancelado',
        data_cancelamento: new Date(),
        plano_atual: null
      });
    }
    return indicacao;
  }

  // ---- Está pagando ----
  if (indicacao) {
    // Reativação: a pessoa voltou a assinar depois de ter cancelado/vencido.
    // Reaproveita a mesma linha em vez de criar outra — o índice único em
    // usuario_indicado_id impede duplicar, e o histórico fica coerente.
    if (indicacao.status !== 'ativo' || indicacao.plano_atual !== usuario.plano_atual) {
      await indicacao.update({
        status: 'ativo',
        plano_atual: usuario.plano_atual,
        data_cancelamento: null
      });
    }
    return indicacao;
  }

  const parceiro = await Parceiro.findByPk(usuario.indicado_por_parceiro_id);
  if (!parceiro) return null;

  try {
    return await Indicacao.create({
      parceiro_id: parceiro.id,
      usuario_indicado_id: usuario.id,
      status: 'ativo',
      plano_atual: usuario.plano_atual,
      data_indicacao: new Date()
    });
  } catch (erroCriacao) {
    // Corrida (webhook duplicado do Mercado Pago é comum): o índice único
    // resolve e aqui só devolvemos a linha que o outro request criou.
    if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
      return await Indicacao.findOne({ where: { usuario_indicado_id: usuario.id } });
    }
    throw erroCriacao;
  }
}

/**
 * Mantido como nome próprio porque é o que o perfilController chama no gatilho
 * de identidade confirmada. Hoje só cria indicação se a pessoa JÁ estiver
 * pagando (caso de quem assina antes de completar a verificação).
 */
async function registrarIndicacaoSeAplicavel(usuarioVerificado) {
  return sincronizarIndicacaoDoUsuario(usuarioVerificado);
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
  sincronizarIndicacaoDoUsuario,
  registrarIndicacaoSeAplicavel,
  resolverParceiroPorCodigo,
  LINK_BASE_PARCEIRO
};
