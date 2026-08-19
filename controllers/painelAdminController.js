const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../database');
const Usuario = require('../models/Usuario');
const PagamentoProcessado = require('../models/PagamentoProcessado');
const Comissao = require('../models/Comissao');
const Parceiro = require('../models/Parceiro');
const Match = require('../models/Match');
const Denuncia = require('../models/Denuncia');
const SessaoSeguranca = require('../models/SessaoSeguranca');
const AlertaSeguranca = require('../models/AlertaSeguranca');
const Mensagem = require('../models/Mensagem');
const { primeiroDiaDoMes } = require('./parceiroController');
const { registrarLogAuditoria } = require('./auditoriaController');
const { executarCascataExclusaoConta, apagarArquivosDaContaExcluida } = require('./contaController');

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

// Status de suspensão pra exibição — Lote 3. Também derivado na hora, mesmo
// padrão de statusPagamento: suspenso_ate no passado não bloqueia mais (ver
// comentário no model Usuario), então não conta como suspenso aqui mesmo
// que o campo ainda tenha uma data antiga guardada.
function statusSuspensao(usuario, agora) {
  if (usuario.suspenso_permanente) return 'permanente';
  if (usuario.suspenso_ate && new Date(usuario.suspenso_ate) > agora) return 'temporaria';
  return null;
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
      attributes: [
        'id', 'nome', 'email', 'verificado', 'premium', 'plano_atual', 'premium_ate',
        'suspenso_ate', 'suspenso_permanente', 'createdAt'
      ],
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
        status_suspensao: statusSuspensao(u, agora),
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
  'suspenso_ate', 'suspenso_permanente', 'suspenso_motivo', 'sessoes_revogadas_em',
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
      status_suspensao: statusSuspensao(usuario, new Date()),
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

const MOTIVO_TAMANHO_MAXIMO = 500;

// POST /api/admin/painel/usuarios/:id/suspender — Lote 3 do plano de acesso
// total. Corpo: { tipo: 'temporaria'|'permanente', ate: 'AAAA-MM-DD' (só se
// temporaria), motivo: string (obrigatório) }. Motivo é obrigatório de
// propósito — toda suspensão precisa de uma justificativa registrada, tanto
// no próprio usuário (suspenso_motivo, pra aparecer na ficha) quanto no log
// de auditoria (histórico completo, mesmo que o motivo do campo seja
// sobrescrito por uma suspensão futura).
const suspenderUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const { tipo, ate, motivo } = req.body || {};

    if (tipo !== 'temporaria' && tipo !== 'permanente') {
      return res.status(400).json({ erro: 'Tipo de suspensão inválido — use "temporaria" ou "permanente"' });
    }

    const motivoLimpo = String(motivo || '').trim().slice(0, MOTIVO_TAMANHO_MAXIMO);
    if (!motivoLimpo) {
      return res.status(400).json({ erro: 'Motivo é obrigatório' });
    }

    let ateData = null;
    if (tipo === 'temporaria') {
      ateData = new Date(ate);
      if (!ate || isNaN(ateData.getTime())) {
        return res.status(400).json({ erro: 'Data de fim da suspensão inválida' });
      }
      if (ateData <= new Date()) {
        return res.status(400).json({ erro: 'A data de fim da suspensão precisa ser no futuro' });
      }
    }

    usuario.suspenso_permanente = tipo === 'permanente';
    usuario.suspenso_ate = tipo === 'temporaria' ? ateData : null;
    usuario.suspenso_motivo = motivoLimpo;
    await usuario.save();

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'suspender_usuario',
      usuarioAlvo: usuario,
      detalhes: { tipo, ate: ateData ? ateData.toISOString() : null, motivo: motivoLimpo }
    });

    res.json({
      ok: true,
      status_suspensao: statusSuspensao(usuario, new Date()),
      suspenso_ate: usuario.suspenso_ate,
      suspenso_permanente: usuario.suspenso_permanente,
      suspenso_motivo: usuario.suspenso_motivo
    });
  } catch (erro) {
    console.error('Erro ao suspender usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao suspender usuário' });
  }
};

// POST /api/admin/painel/usuarios/:id/remover-suspensao — Lote 3. Corpo
// opcional: { motivo: string }. Se o usuário não estiver suspenso agora
// (nem temporária vencida ainda marcada, nem permanente), recusa — evita
// poluir o log de auditoria com remoções que não removeram nada.
const removerSuspensaoUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    if (!usuario.suspenso_permanente && !usuario.suspenso_ate) {
      return res.status(400).json({ erro: 'Usuário não está suspenso' });
    }

    const suspensaoAnterior = {
      tipo: usuario.suspenso_permanente ? 'permanente' : 'temporaria',
      ate: usuario.suspenso_ate,
      motivo: usuario.suspenso_motivo
    };

    usuario.suspenso_permanente = false;
    usuario.suspenso_ate = null;
    usuario.suspenso_motivo = null;
    await usuario.save();

    const motivoRemocao = String((req.body && req.body.motivo) || '').trim().slice(0, MOTIVO_TAMANHO_MAXIMO) || null;

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'remover_suspensao_usuario',
      usuarioAlvo: usuario,
      detalhes: { suspensao_anterior: suspensaoAnterior, motivo_remocao: motivoRemocao }
    });

    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro ao remover suspensão de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao remover suspensão' });
  }
};

// POST /api/admin/painel/usuarios/:id/revogar-sessoes — Lote 4 do plano de
// acesso total. Não usa a tabela TokenRevogado (é por jti individual, e o
// servidor não sabe quais jtis estão ativos nos dispositivos do usuário —
// ver comentário em models/Usuario.js). Em vez disso, marca
// sessoes_revogadas_em = agora; authMiddleware rejeita qualquer token
// emitido antes desse instante, em qualquer dispositivo. Sem corpo
// obrigatório — é uma ação simples, sem motivo (diferente da suspensão).
const revogarSessoesUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    usuario.sessoes_revogadas_em = new Date();
    await usuario.save();

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'revogar_sessoes_usuario',
      usuarioAlvo: usuario,
      detalhes: { revogado_em: usuario.sessoes_revogadas_em.toISOString() }
    });

    res.json({ ok: true, sessoes_revogadas_em: usuario.sessoes_revogadas_em });
  } catch (erro) {
    console.error('Erro ao revogar sessões de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao revogar sessões do usuário' });
  }
};

// Sem 0/O nem 1/l/I — evita confusão quando o admin lê a senha em voz alta
// ou repassa por mensagem de texto pro usuário.
const ALFABETO_SENHA_TEMPORARIA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function gerarSenhaTemporaria(tamanho = 12) {
  const bytes = crypto.randomBytes(tamanho);
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += ALFABETO_SENHA_TEMPORARIA[bytes[i] % ALFABETO_SENHA_TEMPORARIA.length];
  }
  return senha;
}

// POST /api/admin/painel/usuarios/:id/resetar-senha — Lote 5 do plano de
// acesso total.
//
// Decisão: gera uma senha temporária aleatória e devolve em texto puro só
// na RESPOSTA desta chamada, uma vez — não fica salva em lugar nenhum além
// do hash na própria conta do usuário, e NUNCA entra no log de auditoria
// (o log registra que um reset aconteceu, nunca a senha em si, nem em
// texto nem hash). Cabe ao admin repassar essa senha pro usuário por outro
// canal (WhatsApp, telefone).
//
// Não reaproveitei o fluxo de recuperação por e-mail que já existe
// (recuperacaoSenhaController.solicitarRecuperacao) de propósito: o cenário
// que você descreveu é justamente alguém que perdeu acesso ao próprio
// e-mail — mandar um link de redefinição pro mesmo e-mail que a pessoa não
// consegue mais acessar não resolve nada. A senha temporária funciona
// mesmo nesse caso, porque não depende do e-mail em momento nenhum.
//
// Também revoga as sessões ativas (mesmo mecanismo do Lote 4): depois de
// um reset de senha faz sentido derrubar qualquer sessão antiga também,
// nem que seja por segurança (ex: se o motivo do reset foi suspeita de
// conta comprometida).
const resetarSenhaUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const senhaTemporaria = gerarSenhaTemporaria();
    usuario.senha = await bcrypt.hash(senhaTemporaria, 10);
    usuario.reset_token = null;
    usuario.reset_token_expira = null;
    usuario.sessoes_revogadas_em = new Date();
    await usuario.save();

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'resetar_senha_usuario',
      usuarioAlvo: usuario
      // Sem "detalhes" de propósito — nunca gravar a senha, nem temporária,
      // num registro de auditoria.
    });

    res.json({ ok: true, senha_temporaria: senhaTemporaria });
  } catch (erro) {
    console.error('Erro ao resetar senha de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao resetar senha do usuário' });
  }
};

// DELETE /api/admin/painel/usuarios/:id — Lote 6 do plano de acesso total.
// A AÇÃO MAIS GRAVE de todo o plano: irreversível, apaga dado de verdade.
// Reaproveita a MESMA cascata de exclusão do autoatendimento
// (contaController.executarCascataExclusaoConta) — nenhuma lógica de
// exclusão duplicada ou reescrita aqui, só uma porta de entrada diferente.
//
// Camadas de proteção, em ordem:
// 1. Não deixa um admin excluir a própria conta por aqui (evita destrancar
//    o próprio acesso por engano) — ação separada, fora de escopo deste lote.
// 2. Motivo obrigatório, mesmo padrão da suspensão.
// 3. Confirmação por e-mail: o corpo da requisição precisa trazer o e-mail
//    EXATO do usuário alvo. O frontend já faz essa checagem antes de
//    chamar a rota (digitar o e-mail pra habilitar o botão), mas repete
//    aqui no backend — a proteção não pode depender só do JavaScript do
//    navegador.
// 4. Só entra na transação de exclusão depois de passar pelas 3 acima.
//
// Antes de excluir, monta um resumo do que a conta representava (tinha
// assinatura ativa? era parceiro do programa? quantos matches/denúncias
// envolvia?) — é capturado ANTES da cascata e vai pro log de auditoria,
// porque depois de excluída não tem mais como consultar nada disso. O
// próprio nome/e-mail do usuário também são congelados num objeto simples
// ANTES da exclusão, pro log de auditoria (usuarioAlvo) não depender da
// instância do Sequelize depois que a linha já foi apagada do banco.
const excluirContaUsuario = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (req.params.id === req.usuarioAdmin.id) {
      await t.rollback();
      return res.status(400).json({ erro: 'Não é possível excluir a própria conta por aqui.' });
    }

    const usuario = await Usuario.findByPk(req.params.id, { transaction: t });
    if (!usuario) {
      await t.rollback();
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    const motivoLimpo = String((req.body && req.body.motivo) || '').trim().slice(0, MOTIVO_TAMANHO_MAXIMO);
    if (!motivoLimpo) {
      await t.rollback();
      return res.status(400).json({ erro: 'Motivo é obrigatório' });
    }

    const emailConfirmacao = String((req.body && req.body.email_confirmacao) || '').trim().toLowerCase();
    if (!emailConfirmacao || emailConfirmacao !== String(usuario.email).toLowerCase()) {
      await t.rollback();
      return res.status(400).json({ erro: 'O e-mail de confirmação não corresponde ao e-mail do usuário' });
    }

    const agora = new Date();
    const [totalMatches, totalDenuncias, parceiroVinculado] = await Promise.all([
      Match.count({
        where: { [Op.or]: [{ usuario1_id: usuario.id }, { usuario2_id: usuario.id }] },
        transaction: t
      }),
      Denuncia.count({
        where: { [Op.or]: [{ denunciante_id: usuario.id }, { denunciado_id: usuario.id }] },
        transaction: t
      }),
      Parceiro.findOne({ where: { usuario_id: usuario.id }, attributes: ['id', 'tipo'], transaction: t })
    ]);

    const resumoAntesDeExcluir = {
      data_cadastro: usuario.createdAt,
      verificado: usuario.verificado,
      status_pagamento: statusPagamento(usuario, agora),
      tinha_indicacao_de_parceiro: !!usuario.indicado_por_parceiro_id,
      era_parceiro_do_programa: !!parceiroVinculado,
      total_matches: totalMatches,
      total_denuncias_envolvendo: totalDenuncias
    };
    const usuarioAlvoParaLog = { id: usuario.id, nome: usuario.nome, email: usuario.email };

    const resultadoArquivos = await executarCascataExclusaoConta(usuario, t);
    await t.commit();
    apagarArquivosDaContaExcluida(resultadoArquivos);

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'excluir_conta_usuario',
      usuarioAlvo: usuarioAlvoParaLog,
      detalhes: { motivo: motivoLimpo, resumo_antes_de_excluir: resumoAntesDeExcluir }
    });

    res.json({ ok: true, mensagem: 'Conta excluída com sucesso.' });
  } catch (erro) {
    await t.rollback();
    console.error('Erro ao excluir conta de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Não foi possível excluir a conta. Tente novamente em instantes.' });
  }
};

// GET /api/admin/painel/usuarios/:id/denuncias — Lote 7 do plano de acesso
// total. Dado sensível (nome, e-mail, telefone de terceiros), por isso NÃO
// é carregado junto com o resto da ficha — só quando o admin clica
// explicitamente pra ver, e cada chamada grava um log de auditoria (a
// visualização em si é o que precisa ficar rastreado, não só uma ação
// sobre o dado).
//
// Traz as denúncias nos dois papéis (o usuário como denunciante e como
// denunciado) e, pra cada uma, os dados de contato da OUTRA pessoa
// envolvida — não da pessoa da ficha, que o admin já está vendo. Busca em
// lote (mesmo padrão do resto do painel): uma consulta pra achar os IDs
// das outras partes, não uma por denúncia.
const obterDenunciasUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, { attributes: ['id', 'nome', 'email'] });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const denuncias = await Denuncia.findAll({
      where: { [Op.or]: [{ denunciante_id: usuario.id }, { denunciado_id: usuario.id }] },
      order: [['createdAt', 'DESC']]
    });

    const idsOutraParte = [...new Set(
      denuncias.map(d => (d.denunciante_id === usuario.id ? d.denunciado_id : d.denunciante_id))
    )];
    const outrasPartes = idsOutraParte.length
      ? await Usuario.findAll({
          where: { id: { [Op.in]: idsOutraParte } },
          attributes: ['id', 'nome', 'email', 'telefone']
        })
      : [];
    const mapaOutrasPartes = new Map(outrasPartes.map(u => [u.id, u]));

    const lista = denuncias.map(d => {
      const ehDenunciante = d.denunciante_id === usuario.id;
      const outraParteId = ehDenunciante ? d.denunciado_id : d.denunciante_id;
      const outraParte = mapaOutrasPartes.get(outraParteId);
      return {
        id: d.id,
        papel: ehDenunciante ? 'denunciante' : 'denunciado',
        outra_parte: outraParte
          ? { nome: outraParte.nome, email: outraParte.email, telefone: outraParte.telefone }
          : null, // conta da outra parte já foi excluída
        motivo: d.motivo,
        descricao: d.descricao,
        status: d.status,
        observacao_admin: d.observacao_admin,
        criado_em: d.createdAt
      };
    });

    res.json({ denuncias: lista });

    registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'ver_denuncias_usuario',
      usuarioAlvo: usuario,
      detalhes: { total_denuncias: lista.length }
    });
  } catch (erro) {
    console.error('Erro ao montar denúncias de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar denúncias do usuário' });
  }
};

// ===== Localização / histórico de check-in de segurança (Lote 9) =====
// Dado sensível (geolocalização). Não precisa de tabela nova: reaproveita
// SessaoSeguranca (check-in de encontro) e AlertaSeguranca (botão de
// pânico + alerta automático de check-in vencido), que já existem no
// fluxo de segurança do usuário comum. Carregamento sob demanda na
// ficha, mesmo padrão dos Lotes 7 e 8.
const obterSegurancaUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, {
      attributes: ['id', 'nome', 'email', 'latitude', 'longitude']
    });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const sessoes = await SessaoSeguranca.findAll({
      where: { usuario_id: usuario.id },
      order: [['createdAt', 'DESC']]
    });
    const alertas = await AlertaSeguranca.findAll({
      where: { usuario_id: usuario.id },
      order: [['createdAt', 'DESC']]
    });

    const idsComUsuario = [...new Set(sessoes.map(s => s.com_usuario_id).filter(Boolean))];
    const comUsuarios = idsComUsuario.length
      ? await Usuario.findAll({ where: { id: { [Op.in]: idsComUsuario } }, attributes: ['id', 'nome'] })
      : [];
    const mapaComUsuarios = new Map(comUsuarios.map(u => [u.id, u.nome]));

    // Status derivado: o job que expira check-ins vencidos marca
    // alerta_disparado=true mas nunca zera "ativa" sozinho — isso só
    // acontece quando o usuário confirma retorno seguro ou começa um
    // novo check-in (que desativa os antigos de lambuja). Por isso
    // "encerrado" aqui não distingue com certeza "confirmou que tava
    // seguro" de "foi substituído por outro check-in" — a coluna não
    // guarda essa diferença, então não inventamos uma certeza que o
    // dado não sustenta.
    const listaSessoes = sessoes.map(s => {
      let status;
      if (s.alerta_disparado) status = 'alerta_disparado';
      else if (!s.ativa) status = 'encerrado';
      else status = 'em_andamento';

      const duracaoMin = s.prazo_confirmacao
        ? Math.round((new Date(s.prazo_confirmacao) - new Date(s.createdAt)) / 60000)
        : null;

      return {
        id: s.id,
        com_usuario_nome: s.com_usuario_id ? (mapaComUsuarios.get(s.com_usuario_id) || null) : null,
        status,
        iniciado_em: s.createdAt,
        prazo_confirmacao: s.prazo_confirmacao,
        duracao_planejada_minutos: duracaoMin,
        ultima_localizacao: (s.ultima_lat != null && s.ultima_lng != null)
          ? { lat: s.ultima_lat, lng: s.ultima_lng }
          : null
      };
    });

    // mensagens_enviadas traz telefone dos contatos de confiança — dado
    // de terceiro que não foi pedido aqui; expõe só nome + resultado do
    // envio, no mesmo espírito de minimização do Lote 7 (não duplicar
    // PII de terceiro que não é o propósito desta tela).
    const listaAlertas = alertas.map(a => ({
      id: a.id,
      tipo: a.tipo,
      disparado_em: a.createdAt,
      localizacao: (a.latitude != null && a.longitude != null)
        ? { lat: a.latitude, lng: a.longitude }
        : null,
      contatos_notificados: Array.isArray(a.mensagens_enviadas)
        ? a.mensagens_enviadas.map(m => ({
            contato_nome: m.contato_nome,
            template_usado: m.template_usado,
            sucesso: m.sucesso
          }))
        : []
    }));

    res.json({
      sessoes_checkin: listaSessoes,
      alertas_seguranca: listaAlertas,
      localizacao_geral_perfil: (usuario.latitude != null && usuario.longitude != null)
        ? { lat: usuario.latitude, lng: usuario.longitude }
        : null
    });

    registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'ver_seguranca_usuario',
      usuarioAlvo: usuario,
      detalhes: { total_sessoes: listaSessoes.length, total_alertas: listaAlertas.length }
    });
  } catch (erro) {
    console.error('Erro ao montar segurança/localização de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar dados de segurança do usuário' });
  }
};

const LIMITE_MENSAGENS_CONVERSA = 50;

// ===== Mensagens de qualquer chat (Lote 10) — nível 1: lista de conversas =====
// O dado mais sensível do sistema (conteúdo de conversa privada). Por isso
// este lote tem dois níveis: listar os matches do usuário (metadado, loga
// auditoria mas sem exigir motivo, mesmo padrão dos Lotes 7/8/9) e abrir o
// conteúdo de uma conversa específica (nível 2, abaixo), que exige motivo
// obrigatório por ser o conteúdo em si — o dado mais sensível de todos, que
// uma vez visto não tem como "devolver".
const obterConversasUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, { attributes: ['id', 'nome', 'email'] });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const matches = await Match.findAll({
      where: { [Op.or]: [{ usuario1_id: usuario.id }, { usuario2_id: usuario.id }] },
      order: [['createdAt', 'DESC']]
    });

    const idsOutraParte = matches.map(m => (m.usuario1_id === usuario.id ? m.usuario2_id : m.usuario1_id));
    const outrasPartes = idsOutraParte.length
      ? await Usuario.findAll({ where: { id: { [Op.in]: idsOutraParte } }, attributes: ['id', 'nome'] })
      : [];
    const mapaOutrasPartes = new Map(outrasPartes.map(u => [u.id, u.nome]));

    const idsMatches = matches.map(m => m.id);
    const agregados = idsMatches.length
      ? await Mensagem.findAll({
          where: { match_id: { [Op.in]: idsMatches } },
          attributes: [
            'match_id',
            [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
            [sequelize.fn('MAX', sequelize.col('createdAt')), 'ultima']
          ],
          group: ['match_id']
        })
      : [];
    const mapaAgregados = new Map(agregados.map(a => [a.match_id, {
      total: Number(a.get('total')),
      ultima: a.get('ultima')
    }]));

    const conversas = matches.map(m => {
      const outraParteId = m.usuario1_id === usuario.id ? m.usuario2_id : m.usuario1_id;
      const agregado = mapaAgregados.get(m.id) || { total: 0, ultima: null };
      return {
        match_id: m.id,
        outro_usuario: { id: outraParteId, nome: mapaOutrasPartes.get(outraParteId) || null },
        ativo: m.ativo,
        total_mensagens: agregado.total,
        ultima_mensagem_em: agregado.ultima,
        match_criado_em: m.createdAt
      };
    });

    res.json({ conversas });

    registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'ver_lista_conversas_usuario',
      usuarioAlvo: usuario,
      detalhes: { total_matches: conversas.length }
    });
  } catch (erro) {
    console.error('Erro ao montar lista de conversas de usuário no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar lista de conversas do usuário' });
  }
};

// ===== Mensagens de qualquer chat (Lote 10) — nível 2: conteúdo de uma
// conversa específica. Exige motivo obrigatório (fica no log de auditoria)
// e é paginado por cursor de data (não por offset, pra não pular/duplicar
// mensagem se a conversa continuar rolando enquanto o admin está olhando).
const obterMensagensConversaUsuario = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, { attributes: ['id', 'nome', 'email'] });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const motivo = String(req.query.motivo || '').trim();
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo para abrir esta conversa' });

    const match = await Match.findOne({
      where: {
        id: req.params.matchId,
        [Op.or]: [{ usuario1_id: usuario.id }, { usuario2_id: usuario.id }]
      }
    });
    if (!match) return res.status(404).json({ erro: 'Conversa não encontrada para este usuário' });

    const outraParteId = match.usuario1_id === usuario.id ? match.usuario2_id : match.usuario1_id;
    const outraParte = await Usuario.findByPk(outraParteId, { attributes: ['id', 'nome', 'email'] });

    const antes = req.query.antes ? new Date(req.query.antes) : null;
    const where = { match_id: match.id };
    if (antes && !isNaN(antes)) where.createdAt = { [Op.lt]: antes };

    const pagina = await Mensagem.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: LIMITE_MENSAGENS_CONVERSA + 1
    });
    const temMaisAntigas = pagina.length > LIMITE_MENSAGENS_CONVERSA;
    const mensagens = pagina.slice(0, LIMITE_MENSAGENS_CONVERSA).reverse().map(m => ({
      id: m.id,
      remetente_id: m.remetente_id,
      conteudo: m.conteudo,
      enviado_em: m.createdAt
    }));

    res.json({
      match_id: match.id,
      outro_usuario: outraParte ? { id: outraParte.id, nome: outraParte.nome } : null,
      mensagens,
      tem_mais_antigas: temMaisAntigas
    });

    // Só grava log na primeira página (abertura da conversa) — paginar pra
    // mensagens mais antigas dentro da mesma conversa já aberta não é um
    // novo evento de acesso, é continuação do mesmo, já coberto pelo motivo
    // dado na abertura.
    if (!antes) {
      const totalMensagens = await Mensagem.count({ where: { match_id: match.id } });
      registrarLogAuditoria({
        admin: req.usuarioAdmin,
        acao: 'ver_mensagens_conversa',
        usuarioAlvo: usuario,
        detalhes: {
          match_id: match.id,
          outro_usuario: outraParte ? { id: outraParte.id, nome: outraParte.nome, email: outraParte.email } : null,
          motivo,
          total_mensagens_no_match: totalMensagens
        }
      });
    }
  } catch (erro) {
    console.error('Erro ao montar mensagens de conversa no painel administrativo:', erro);
    res.status(500).json({ erro: 'Erro ao montar mensagens da conversa' });
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
  suspenderUsuario,
  removerSuspensaoUsuario,
  revogarSessoesUsuario,
  resetarSenhaUsuario,
  excluirContaUsuario,
  obterDenunciasUsuario,
  obterSegurancaUsuario,
  obterConversasUsuario,
  obterMensagensConversaUsuario,
  obterRankingComissoes,
  obterSegmentacaoPagantes
};
