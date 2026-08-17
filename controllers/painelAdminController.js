const { Op } = require('sequelize');
const { sequelize } = require('../database');
const Usuario = require('../models/Usuario');
const PagamentoProcessado = require('../models/PagamentoProcessado');
const Comissao = require('../models/Comissao');
const { primeiroDiaDoMes } = require('./parceiroController');

function somaDecimal(valor) {
  return Number(valor || 0);
}

// Assinante "ativo" = mesmo critério de verificarAssinaturasVencidas
// (pagamentoController.js): plano confirmado e dentro da validade agora.
// Contas premium legadas (premium=true, premium_ate=null, fase gratuita
// antiga) NÃO entram aqui — não são pagantes de verdade.
async function buscarAssinantesAtivos() {
  const agora = new Date();
  const usuarios = await Usuario.findAll({
    where: {
      plano_atual: { [Op.ne]: null },
      premium_ate: { [Op.ne]: null, [Op.gt]: agora }
    },
    attributes: ['id', 'nome', 'email', 'plano_atual', 'premium_ate'],
    order: [['premium_ate', 'ASC']]
  });

  if (!usuarios.length) {
    return { total_ativos: 0, por_metodo: { pix: 0, cartao: 0, desconhecido: 0 }, lista: [] };
  }

  // Método e data de início do ciclo atual vêm do pagamento mais recente de
  // cada usuário no ledger unificado. Busca em lote (mesmo padrão do resto
  // do painel admin) — mantém só a linha mais recente por usuário.
  const pagamentos = await PagamentoProcessado.findAll({
    where: { usuario_id: { [Op.in]: usuarios.map(u => u.id) } },
    order: [['processado_em', 'DESC']],
    attributes: ['usuario_id', 'metodo', 'processado_em']
  });
  const ultimoPorUsuario = new Map();
  for (const p of pagamentos) {
    if (!ultimoPorUsuario.has(p.usuario_id)) ultimoPorUsuario.set(p.usuario_id, p);
  }

  const por_metodo = { pix: 0, cartao: 0, desconhecido: 0 };
  const lista = usuarios.map(u => {
    const ultimo = ultimoPorUsuario.get(u.id);
    const metodo = ultimo ? ultimo.metodo : 'desconhecido';
    por_metodo[metodo]++;
    return {
      nome: u.nome,
      email: u.email,
      plano: u.plano_atual,
      metodo,
      // Ausente pra quem assinou antes desta tabela existir (limitação
      // conhecida — sem histórico retroativo).
      data_inicio_ciclo_atual: ultimo ? ultimo.processado_em : null,
      proxima_cobranca: u.premium_ate
    };
  });

  return { total_ativos: usuarios.length, por_metodo, lista };
}

async function buscarFinanceiro() {
  const mesAtual = primeiroDiaDoMes();
  const inicioMesAtual = new Date(mesAtual + 'T00:00:00');

  const receitaMesAtual = await PagamentoProcessado.sum('valor', {
    where: { processado_em: { [Op.gte]: inicioMesAtual } }
  });

  // Histórico mês a mês, simples: agrupa por competência a partir da data
  // do pagamento. to_char em vez de date_trunc pra já sair no formato
  // "AAAA-MM" pronto pra exibir.
  const receitaPorMesRaw = await PagamentoProcessado.findAll({
    attributes: [
      [sequelize.fn('to_char', sequelize.col('processado_em'), 'YYYY-MM'), 'mes'],
      [sequelize.fn('SUM', sequelize.col('valor')), 'total']
    ],
    group: ['mes'],
    order: [[sequelize.literal('mes'), 'ASC']]
  });
  const receita_por_mes = receitaPorMesRaw.map(r => ({
    mes: r.get('mes'),
    total: somaDecimal(r.get('total'))
  }));

  const comissaoPagaHistorico = await Comissao.sum('valor', { where: { status_pagamento: 'pago' } });
  const comissaoPendenteMesAtual = await Comissao.sum('valor', {
    where: { status_pagamento: 'pendente', mes_referencia: mesAtual }
  });
  const comissaoPagaMesAtual = await Comissao.sum('valor', {
    where: { status_pagamento: 'pago', mes_referencia: mesAtual }
  });

  return {
    receita_mes_atual: somaDecimal(receitaMesAtual),
    receita_por_mes,
    comissao_paga_historico: somaDecimal(comissaoPagaHistorico),
    comissao_pendente_mes_atual: somaDecimal(comissaoPendenteMesAtual),
    // Aproximada de propósito: receita bruta do mês (sem descontar taxa do
    // Mercado Pago) menos comissão já PAGA no mês — referência rápida, não
    // é margem contábil exata.
    margem_liquida_mes_atual: somaDecimal(receitaMesAtual) - somaDecimal(comissaoPagaMesAtual)
  };
}

const obterPainel = async (req, res) => {
  try {
    const [assinantes, financeiro] = await Promise.all([buscarAssinantesAtivos(), buscarFinanceiro()]);
    res.json({ assinantes, financeiro });
  } catch (erro) {
    console.error('Erro ao montar painel administrativo central:', erro);
    res.status(500).json({ erro: 'Erro ao montar painel' });
  }
};

// Status de pagamento pra exibição — não é um campo salvo, é derivado na
// hora a partir de plano_atual/premium/premium_ate:
// - pagante_ativo: tem plano confirmado e ainda dentro da validade.
// - vitalicio_legado: conta premium da fase gratuita antiga (premium=true,
//   premium_ate nunca setado) — nunca pagou, mas ainda tem acesso completo.
//   Rotulado à parte pra não ser confundido com "gratuito" de verdade.
// - vencido: já teve premium_ate no passado (assinou uma vez) e não está
//   mais dentro da validade — plano_atual pode já estar null aqui, porque
//   verificarAssinaturasVencidas o limpa quando encerra o plano.
// - gratuito: nunca teve premium_ate setado e não é o caso legado acima.
function statusPagamento(usuario, agora) {
  if (usuario.plano_atual && usuario.premium_ate && usuario.premium_ate > agora) return 'pagante_ativo';
  if (usuario.premium && !usuario.premium_ate) return 'vitalicio_legado';
  if (usuario.premium_ate && usuario.premium_ate <= agora) return 'vencido';
  return 'gratuito';
}

const PAGINA_TAMANHO_PADRAO = 25;
const PAGINA_TAMANHO_MAXIMO = 100;

// Lista detalhada de usuários pro Painel Central — Lote 1. Busca por
// nome/e-mail (case-insensitive) e paginação simples, pra não precisar
// carregar a base inteira de uma vez conforme ela cresce.
const listarUsuarios = async (req, res) => {
  try {
    const busca = String(req.query.busca || '').trim().slice(0, 100);
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = Math.min(
      PAGINA_TAMANHO_MAXIMO,
      Math.max(1, parseInt(req.query.por_pagina, 10) || PAGINA_TAMANHO_PADRAO)
    );

    const where = busca
      ? {
          [Op.or]: [
            { nome: { [Op.iLike]: `%${busca}%` } },
            { email: { [Op.iLike]: `%${busca}%` } }
          ]
        }
      : {};

    const { count, rows } = await Usuario.findAndCountAll({
      where,
      attributes: ['nome', 'email', 'verificado', 'premium', 'plano_atual', 'premium_ate', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: porPagina,
      offset: (pagina - 1) * porPagina
    });

    const agora = new Date();
    res.json({
      usuarios: rows.map(u => ({
        nome: u.nome,
        email: u.email,
        verificado: u.verificado,
        status_pagamento: statusPagamento(u, agora),
        data_cadastro: u.createdAt
      })),
      total: count,
      pagina,
      por_pagina: porPagina,
      total_paginas: Math.max(1, Math.ceil(count / porPagina))
    });
  } catch (erro) {
    console.error('Erro ao listar usuários no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao listar usuários' });
  }
};

module.exports = { obterPainel, listarUsuarios };
