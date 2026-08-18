const { Op } = require('sequelize');
const { sequelize } = require('../database');
const Usuario = require('../models/Usuario');
const PagamentoProcessado = require('../models/PagamentoProcessado');
const Comissao = require('../models/Comissao');
const Parceiro = require('../models/Parceiro');
const { primeiroDiaDoMes } = require('./parceiroController');
const { registrarLogAuditoria } = require('./auditoriaController');

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
      attributes: ['id', 'nome', 'email', 'verificado', 'premium', 'plano_atual', 'premium_ate', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: porPagina,
      offset: (pagina - 1) * porPagina
    });

    const agora = new Date();
    res.json({
      usuarios: rows.map(u => ({
        id: u.id,
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

// Campos do Usuario que NÃO voltam na ficha, mesmo pro admin: senha e
// tokens de reset (credenciais), e as três referências ligadas ao
// reconhecimento facial (foto_verificacao, foto_referencia_liveness,
// liveness_session_pendente) — verificação facial é dado sensível à parte,
// com rota própria já protegida (obterFotoLivenessAdmin) e vai ganhar
// exibição no painel só no Lote 8, com o log de auditoria já registrando
// cada acesso.
const CAMPOS_FICHA_USUARIO = [
  'id', 'nome', 'email', 'telefone', 'data_nascimento', 'genero', 'objetivo',
  'estilo_vida', 'interesses', 'signo', 'bio', 'foto_url', 'instagram_handle',
  'altura', 'peso', 'cor_cabelo', 'cidade', 'latitude', 'longitude', 'prompts',
  'pref_genero', 'pref_idade_min', 'pref_idade_max', 'pref_distancia_km',
  'pref_apenas_verificados', 'pref_objetivo', 'pref_altura_min', 'pref_altura_max',
  'pref_peso_min', 'pref_peso_max', 'pref_cor_cabelo',
  'verificado', 'liveness_aprovado', 'liveness_confianca', 'premium', 'premium_ate',
  'plano_atual', 'ativo', 'is_admin', 'tour_seguranca_visto',
  'codigo_indicacao', 'indicado_por', 'bonus_indicacao_creditado',
  'indicado_por_parceiro_id', 'mercadopago_subscription_id',
  'createdAt', 'updatedAt'
];

// Ficha completa de um único usuário pro Painel Central — Lote 1. Só
// leitura por enquanto (as ações administrativas em cima dela vêm nos
// próximos lotes). O id explícito na resposta é o que falta hoje pra
// conseguir mirar num usuário específico nas próximas ações.
const obterUsuarioDetalhe = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, { attributes: CAMPOS_FICHA_USUARIO });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // Método e data do pagamento mais recente, mesmo dado que já aparece na
    // lista de assinantes ativos do painel — dá contexto de pagamento sem
    // precisar abrir outra tela.
    const ultimoPagamento = await PagamentoProcessado.findOne({
      where: { usuario_id: usuario.id },
      order: [['processado_em', 'DESC']],
      attributes: ['metodo', 'plano', 'valor', 'processado_em']
    });

    res.json({
      ...usuario.get({ plain: true }),
      status_pagamento: statusPagamento(usuario, new Date()),
      ultimo_pagamento: ultimoPagamento
        ? {
            metodo: ultimoPagamento.metodo,
            plano: ultimoPagamento.plano,
            valor: somaDecimal(ultimoPagamento.valor),
            processado_em: ultimoPagamento.processado_em
          }
        : null
    });

    // Log de auditoria: por decisão explícita, toda abertura de ficha
    // completa de usuário fica registrada, mesmo os campos aqui sendo menos
    // sensíveis que mensagens/localização/foto de verificação — mantém
    // consistência total do rastro de acesso. Depois de responder (não
    // atrasa a ficha na tela do admin).
    registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'ver_ficha_usuario',
      usuarioAlvo: usuario
    });
  } catch (erro) {
    console.error('Erro ao montar ficha de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar ficha do usuário' });
  }
};

// Campos de perfil editáveis pelo admin — Lote 2 do plano de acesso total
// (não confundir com o "Lote 2" mais antigo do ranking de comissão, logo
// abaixo). Ficam de fora de propósito, mesmo sendo campos do Usuario:
// - senha, reset_token, reset_token_expira: credenciais, fora do escopo de
//   "editar perfil".
// - foto_verificacao, foto_referencia_liveness, liveness_session_pendente,
//   liveness_aprovado, liveness_confianca: resultado do processo de
//   verificação facial (AWS Rekognition) — não é editável à mão.
// - verificado, premium, premium_ate, plano_atual, ativo, is_admin: estado
//   de negócio/acesso, não "dado de perfil". Editar isso à mão aqui criaria
//   inconsistência com os fluxos que já governam esses campos (webhook de
//   pagamento, verificação, e a suspensão/exclusão que ainda vêm nos
//   próximos lotes). Se precisar mudar algum desses manualmente no futuro,
//   melhor uma ação própria (com sua própria decisão de negócio e log
//   específico) do que misturar no editor genérico de perfil.
// - codigo_indicacao, indicado_por, bonus_indicacao_creditado,
//   indicado_por_parceiro_id, mercadopago_subscription_id: identificadores
//   dos programas de indicação/parceiro — o próprio model já documenta
//   indicado_por_parceiro_id como "imutável" (é a base de comissão
//   recorrente); mexer à mão aqui poderia quebrar atribuição de comissão.
// - id, createdAt, updatedAt: gerenciados pelo banco.
const CAMPOS_EDITAVEIS_USUARIO = [
  'nome', 'email', 'telefone', 'data_nascimento', 'genero', 'objetivo',
  'estilo_vida', 'interesses', 'signo', 'bio', 'foto_url', 'instagram_handle',
  'altura', 'peso', 'cor_cabelo', 'cidade', 'latitude', 'longitude', 'prompts',
  'pref_genero', 'pref_idade_min', 'pref_idade_max', 'pref_distancia_km',
  'pref_apenas_verificados', 'pref_objetivo', 'pref_altura_min', 'pref_altura_max',
  'pref_peso_min', 'pref_peso_max', 'pref_cor_cabelo'
];

function valoresIguais(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// PATCH /api/admin/painel/usuarios/:id — edita um ou mais campos de perfil
// de qualquer usuário. Só aplica os campos que estão em
// CAMPOS_EDITAVEIS_USUARIO (o resto do corpo é ignorado, não dá erro — fica
// listado em campos_ignorados na resposta) e só grava no banco/loga os que
// realmente mudaram de valor. Um log de auditoria por chamada, com a lista
// de { campo, valor_antigo, valor_novo } de tudo que mudou — não um log por
// campo, pra não fragmentar o registro de uma única edição feita de uma vez.
const editarUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const corpo = req.body && typeof req.body === 'object' ? req.body : {};
    const camposRecebidos = Object.keys(corpo);
    const camposValidos = camposRecebidos.filter(c => CAMPOS_EDITAVEIS_USUARIO.includes(c));
    const camposIgnorados = camposRecebidos.filter(c => !CAMPOS_EDITAVEIS_USUARIO.includes(c));

    if (!camposValidos.length) {
      return res.status(400).json({
        erro: 'Nenhum campo editável foi enviado',
        campos_editaveis: CAMPOS_EDITAVEIS_USUARIO,
        campos_ignorados: camposIgnorados
      });
    }

    const alteracoes = [];
    for (const campo of camposValidos) {
      const valorAntigo = usuario[campo];
      const valorNovo = corpo[campo];
      if (!valoresIguais(valorAntigo, valorNovo)) {
        alteracoes.push({
          campo,
          valor_antigo: valorAntigo === undefined ? null : valorAntigo,
          valor_novo: valorNovo === undefined ? null : valorNovo
        });
        usuario[campo] = valorNovo;
      }
    }

    if (!alteracoes.length) {
      return res.json({ ok: true, alterado: false, campos_ignorados: camposIgnorados });
    }

    await usuario.save();

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'editar_perfil_usuario',
      usuarioAlvo: usuario,
      detalhes: { campos_alterados: alteracoes }
    });

    res.json({
      ok: true,
      alterado: true,
      campos_alterados: alteracoes.map(a => a.campo),
      campos_ignorados: camposIgnorados
    });
  } catch (erro) {
    if (erro.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ erro: 'Já existe um usuário com esse e-mail' });
    }
    if (erro.name === 'SequelizeValidationError') {
      return res.status(400).json({ erro: 'Dado inválido: ' + erro.message });
    }
    console.error('Erro ao editar usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao editar usuário' });
  }
};

// Ranking de comissão pro Painel Central — Lote 2 (do plano original de
// conteúdo do painel, anterior ao plano de acesso total). "Quanto já ganharam" é
// tratado como comissão GERADA (paga + pendente), não só a já paga — é uma
// medida de performance da indicação, não de fluxo de caixa. Se um dia fizer
// mais sentido ver só o que já foi efetivamente pago, dá pra filtrar
// status_pagamento:'pago' nas duas agregações abaixo.
const obterRankingComissoes = async (req, res) => {
  try {
    const mesAtual = primeiroDiaDoMes();

    // Duas agregações em lote (mesmo padrão de listarComissoes): total
    // histórico por parceiro, e total só do mês atual por parceiro.
    const totalHistoricoRaw = await Comissao.findAll({
      attributes: ['parceiro_id', [sequelize.fn('SUM', sequelize.col('valor')), 'total']],
      group: ['parceiro_id']
    });
    const totalMesAtualRaw = await Comissao.findAll({
      attributes: ['parceiro_id', [sequelize.fn('SUM', sequelize.col('valor')), 'total']],
      where: { mes_referencia: mesAtual },
      group: ['parceiro_id']
    });

    if (!totalHistoricoRaw.length) return res.json({ ranking: [] });

    const totalMesAtualPorParceiro = new Map(
      totalMesAtualRaw.map(r => [r.parceiro_id, somaDecimal(r.get('total'))])
    );

    const idsParceiros = totalHistoricoRaw.map(r => r.parceiro_id);
    const parceiros = await Parceiro.findAll({
      where: { id: { [Op.in]: idsParceiros } },
      attributes: ['id', 'usuario_id', 'tipo', 'nome_instituicao']
    });
    const mapaParceiros = new Map(parceiros.map(p => [p.id, p]));

    const usuarios = await Usuario.findAll({
      where: { id: { [Op.in]: parceiros.map(p => p.usuario_id) } },
      attributes: ['id', 'nome']
    });
    const mapaUsuarios = new Map(usuarios.map(u => [u.id, u]));

    const ranking = totalHistoricoRaw
      .map(r => {
        const parceiro = mapaParceiros.get(r.parceiro_id);
        const usuario = parceiro ? mapaUsuarios.get(parceiro.usuario_id) : null;
        return {
          nome: parceiro && parceiro.nome_instituicao
            ? parceiro.nome_instituicao
            : (usuario ? usuario.nome : '(parceiro removido)'),
          tipo: parceiro ? parceiro.tipo : null,
          valor_total_historico: somaDecimal(r.get('total')),
          valor_mes_atual: totalMesAtualPorParceiro.get(r.parceiro_id) || 0
        };
      })
      .sort((a, b) => b.valor_total_historico - a.valor_total_historico);

    res.json({ ranking });
  } catch (erro) {
    console.error('Erro ao montar ranking de comissão no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar ranking de comissão' });
  }
};

const LISTA_POSSIVEIS_PAGANTES_LIMITE = 200;

// Possíveis pagantes vs pagantes pro Painel Central — Lote 3.
//
// "Possíveis pagantes" = verificado + ativo (usando o app normalmente) e SEM
// plano_atual — inclui quem nunca assinou e quem já assinou e venceu
// (candidato a reconquista). EXCLUI de propósito quem é premium vitalício
// legado (premium=true, premium_ate nunca setado): essas contas já têm
// acesso completo de graça, contatar oferecendo assinatura não faz sentido
// pra elas.
//
// "Pagantes" = mesmo critério de assinante ativo usado no resto do painel
// (buscarAssinantesAtivos): plano confirmado e dentro da validade agora.
const obterSegmentacaoPagantes = async (req, res) => {
  try {
    const agora = new Date();

    const ondePossiveisPagantes = {
      verificado: true,
      ativo: true,
      plano_atual: null,
      premium: false
    };

    const [possiveisPagantesResultado, totalPagantes] = await Promise.all([
      Usuario.findAndCountAll({
        where: ondePossiveisPagantes,
        attributes: ['nome', 'email'],
        order: [['createdAt', 'DESC']],
        limit: LISTA_POSSIVEIS_PAGANTES_LIMITE
      }),
      Usuario.count({
        where: {
          plano_atual: { [Op.ne]: null },
          premium_ate: { [Op.ne]: null, [Op.gt]: agora }
        }
      })
    ]);

    res.json({
      possiveis_pagantes: {
        total: possiveisPagantesResultado.count,
        lista: possiveisPagantesResultado.rows.map(u => ({ nome: u.nome, email: u.email })),
        // Se a lista foi cortada no limite, o total ainda reflete o valor
        // certo — só a lista exibida que fica menor que o total.
        lista_truncada: possiveisPagantesResultado.count > LISTA_POSSIVEIS_PAGANTES_LIMITE
      },
      pagantes: {
        total: totalPagantes
      }
    });
  } catch (erro) {
    console.error('Erro ao montar segmentação de pagantes no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar segmentação de pagantes' });
  }
};

module.exports = {
  obterPainel,
  listarUsuarios,
  obterUsuarioDetalhe,
  editarUsuario,
  obterRankingComissoes,
  obterSegmentacaoPagantes
};
