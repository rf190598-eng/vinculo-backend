const { Op, fn, col } = require('sequelize');
const Usuario = require('../models/Usuario');
const Parceiro = require('../models/Parceiro');
const Indicacao = require('../models/Indicacao');
const Comissao = require('../models/Comissao');
const BonusMeta = require('../models/BonusMeta');

// Base do link curto de parceiro. Configurável por env porque o domínio final
// pode mudar antes do lançamento — e o link vai impresso/compartilhado por aí,
// então não pode depender de hardcode espalhado.
const LINK_BASE_PARCEIRO = process.env.APP_LINK_BASE || 'https://app.vinculoapp.com.br';

// Valor pago por indicado ativo, por mês. Espelha o default de comissao_base
// no model Parceiro — cada parceiro pode ter o seu próprio valor negociado.
const COMISSAO_PADRAO = 5.00;

// Faixas do parceiro INSTITUCIONAL (atléticas). A faixa é do PARCEIRO como um
// todo, não por indicação: quem tem 60 ativos recebe 8,00 por CADA um dos 60,
// não 6,50 nos 49 primeiros e 8,00 nos 11 restantes.
const FAIXAS_INSTITUCIONAL = [
  { min: 150, valor: 10.00 },
  { min: 50,  valor: 8.00 },
  { min: 1,   valor: 6.50 }
];

/**
 * Valor unitário da comissão deste parceiro neste fechamento.
 * - institucional: faixa por volume de indicações ativas
 * - individual: comissao_base do próprio parceiro (hoje R$ 5,00)
 */
function valorComissaoUnitaria(parceiro, qtdAtivas) {
  if (parceiro.tipo === 'institucional') {
    const faixa = FAIXAS_INSTITUCIONAL.find(f => qtdAtivas >= f.min);
    return faixa ? faixa.valor : 0;
  }
  return Number(parceiro.comissao_base || COMISSAO_PADRAO);
}

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
 * POST /api/parceiros/solicitar-institucional  (autenticada)
 *
 * Exige login: o parceiro precisa estar amarrado a um usuario_id (é a conta
 * que recebe, e o código de indicação vive nela). Quem não tem conta cria uma
 * antes — evita um cadastro paralelo e um estado de "parceiro órfão".
 *
 * Como meuParceiro já cria um parceiro individual na primeira visita à tela,
 * o caso comum aqui é CONVERTER a linha existente, não criar outra: cada
 * usuário tem no máximo um parceiro, e converter preserva o código de
 * indicação que a pessoa talvez já tenha divulgado.
 */
const solicitarInstitucional = async (req, res) => {
  try {
    const { nome_completo, nome_instituicao, email_contato, chave_pix, mensagem } = req.body || {};

    const limpar = (v, max) => String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
    const nomeInstituicao = limpar(nome_instituicao, 150);
    const chavePix = limpar(chave_pix, 150);
    const nomeCompleto = limpar(nome_completo, 120);
    const emailContato = limpar(email_contato, 150);

    if (!nomeInstituicao) return res.status(400).json({ erro: 'Informe o nome da instituição/atlética' });
    if (!chavePix) return res.status(400).json({ erro: 'Informe a chave Pix da instituição' });
    if (!nomeCompleto) return res.status(400).json({ erro: 'Informe seu nome completo' });

    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: ['id', 'nome'] });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    let parceiro = await Parceiro.findOne({ where: { usuario_id: req.usuarioId } });

    if (parceiro && parceiro.tipo === 'institucional' && parceiro.status === 'pendente_aprovacao') {
      return res.status(409).json({ erro: 'Você já tem uma solicitação institucional em análise.' });
    }

    const dados = {
      tipo: 'institucional',
      status: 'pendente_aprovacao',
      nome_instituicao: nomeInstituicao,
      chave_pix: chavePix,
      // Guardados como observação para o admin avaliar. Não viram colunas
      // próprias porque só interessam no momento da análise.
      observacao_solicitacao: [
        'Responsável: ' + nomeCompleto,
        emailContato ? 'E-mail de contato: ' + emailContato : null,
        mensagem ? 'Mensagem: ' + limpar(mensagem, 1000) : null
      ].filter(Boolean).join(' | ')
    };

    if (parceiro) {
      await parceiro.update(dados);
    } else {
      const codigo = await gerarCodigoParceiroUnico(usuario.nome);
      parceiro = await Parceiro.create({
        usuario_id: req.usuarioId,
        codigo_indicacao: codigo,
        comissao_base: COMISSAO_PADRAO,
        ...dados
      });
    }

    res.status(201).json({
      mensagem: 'Solicitação enviada! Você será avisado quando for analisada.',
      id: parceiro.id,
      status: parceiro.status
    });
  } catch (erro) {
    console.error('Erro ao solicitar parceria institucional:', erro);
    res.status(500).json({ erro: 'Erro ao enviar solicitação: ' + erro.message });
  }
};

/**
 * Verifica metas de bônus ainda não atingidas e credita as que bateram.
 *
 * Roda de hora em hora (não junto do fechamento mensal) porque uma meta de
 * 30 dias precisa ser detectada perto do momento em que é batida, não só na
 * virada do mês.
 *
 * O bônus vira uma linha em "comissoes" com tipo='bonus_meta' e
 * indicacao_id NULL — assim entra automaticamente no total a pagar e no fluxo
 * de "marcar como pago" que já existem, sem duplicar nada.
 */
async function verificarMetasAtingidas() {
  const metas = await BonusMeta.findAll({ where: { atingida: false } });
  if (!metas.length) return { avaliadas: 0, atingidas: 0, valor_total: 0 };

  const idsParceiros = [...new Set(metas.map(m => m.parceiro_id))];
  const ativas = await Indicacao.findAll({
    where: { parceiro_id: { [Op.in]: idsParceiros }, status: 'ativo' },
    attributes: ['parceiro_id']
  });
  const contagem = new Map();
  for (const ind of ativas) {
    contagem.set(ind.parceiro_id, (contagem.get(ind.parceiro_id) || 0) + 1);
  }

  const agora = new Date();
  let atingidas = 0;
  let valorTotal = 0;

  for (const meta of metas) {
    const prazoFinal = new Date(new Date(meta.data_inicio).getTime() + meta.prazo_dias * 24 * 60 * 60 * 1000);
    // Fora do prazo: não credita. A meta fica com atingida=false para sempre,
    // que é como o painel distingue "expirada sem bater" de "ainda correndo".
    if (agora > prazoFinal) continue;

    const quantas = contagem.get(meta.parceiro_id) || 0;
    if (quantas < meta.meta_usuarios) continue;

    const valor = Number(meta.valor_bonus || 0);
    try {
      await Comissao.create({
        parceiro_id: meta.parceiro_id,
        indicacao_id: null,
        bonus_meta_id: meta.id,
        tipo: 'bonus_meta',
        mes_referencia: primeiroDiaDoMes(),
        valor,
        status_pagamento: 'pendente'
      });
      await meta.update({ atingida: true, data_atingida: agora });
      atingidas++;
      valorTotal += valor;
    } catch (erroCriacao) {
      // Índice único parcial em bonus_meta_id: se outra execução já creditou,
      // só garantimos que a meta fique marcada e seguimos.
      if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
        if (!meta.atingida) await meta.update({ atingida: true, data_atingida: agora });
      } else {
        console.error('Erro ao creditar bônus de meta', meta.id, erroCriacao.message);
      }
    }
  }

  if (atingidas) {
    console.log(`[metas] ${atingidas} meta(s) atingida(s), total R$ ${valorTotal.toFixed(2)} em bônus.`);
  }
  return { avaliadas: metas.length, atingidas, valor_total: Number(valorTotal.toFixed(2)) };
}

/**
 * Fecha as comissões do mês de referência informado (ou do mês corrente).
 *
 * Gera UMA linha em "comissoes" por indicação ativa, no valor da comissao_base
 * DAQUELE parceiro — não um número fixo aqui, porque parceiro institucional
 * pode ter percentual negociado diferente.
 *
 * Idempotente por construção: antes de criar, lê as comissões que já existem
 * para o mês e pula as indicações já contempladas. Além disso, o índice único
 * uq_comissoes_indicacao_mes (indicacao_id, mes_referencia) é a rede de
 * segurança no banco — mesmo se duas execuções rodarem em paralelo, a segunda
 * esbarra na constraint em vez de duplicar dinheiro a pagar.
 *
 * Retorna um resumo pra quem chamou (job ou rota admin) poder logar/responder.
 */
async function fecharComissoesDoMes(mesReferencia) {
  const mes = mesReferencia || primeiroDiaDoMes();

  const indicacoesAtivas = await Indicacao.findAll({
    where: { status: 'ativo' },
    attributes: ['id', 'parceiro_id']
  });

  if (!indicacoesAtivas.length) {
    return { mes_referencia: mes, criadas: 0, ja_existiam: 0, ignoradas_sem_parceiro: 0, valor_total: 0 };
  }

  // Uma consulta só pra saber o que já foi fechado neste mês, em vez de um
  // SELECT por indicação.
  const jaFechadas = await Comissao.findAll({
    where: {
      mes_referencia: mes,
      indicacao_id: { [Op.in]: indicacoesAtivas.map(i => i.id) }
    },
    attributes: ['indicacao_id']
  });
  const idsJaFechados = new Set(jaFechadas.map(c => c.indicacao_id));

  // Carrega os parceiros envolvidos de uma vez, pra pegar comissao_base sem
  // uma consulta por linha.
  const idsParceiros = [...new Set(indicacoesAtivas.map(i => i.parceiro_id))];
  const parceiros = await Parceiro.findAll({
    where: { id: { [Op.in]: idsParceiros } },
    attributes: ['id', 'tipo', 'comissao_base', 'status']
  });
  const mapaParceiros = new Map(parceiros.map(p => [p.id, p]));

  // Quantas indicações ativas cada parceiro tem AGORA — é isso que define a
  // faixa do institucional. Contado sobre a mesma lista que está sendo
  // fechada, então faixa e cobrança sempre olham o mesmo retrato.
  const ativasPorParceiro = new Map();
  for (const ind of indicacoesAtivas) {
    ativasPorParceiro.set(ind.parceiro_id, (ativasPorParceiro.get(ind.parceiro_id) || 0) + 1);
  }

  let criadas = 0;
  let ignoradasSemParceiro = 0;
  let valorTotal = 0;

  for (const indicacao of indicacoesAtivas) {
    if (idsJaFechados.has(indicacao.id)) continue;

    const parceiro = mapaParceiros.get(indicacao.parceiro_id);
    // Parceiro suspenso não acumula comissão nova. A indicação continua ativa
    // (a pessoa indicada segue pagando), mas o mês não é creditado.
    if (!parceiro || parceiro.status !== 'ativo') {
      ignoradasSemParceiro++;
      continue;
    }

    const valor = valorComissaoUnitaria(parceiro, ativasPorParceiro.get(parceiro.id) || 0);
    if (!valor) { ignoradasSemParceiro++; continue; }

    try {
      await Comissao.create({
        parceiro_id: parceiro.id,
        indicacao_id: indicacao.id,
        tipo: 'recorrente',
        mes_referencia: mes,
        valor,
        status_pagamento: 'pendente'
      });
      criadas++;
      valorTotal += valor;
    } catch (erroCriacao) {
      // Execução concorrente já criou esta linha: o índice único barrou.
      // Não é erro de verdade — só não conta como criada.
      if (erroCriacao.name !== 'SequelizeUniqueConstraintError') throw erroCriacao;
    }
  }

  return {
    mes_referencia: mes,
    criadas,
    ja_existiam: idsJaFechados.size,
    ignoradas_sem_parceiro: ignoradasSemParceiro,
    valor_total: Number(valorTotal.toFixed(2))
  };
}

/**
 * POST /api/admin/parceiros/fechar-comissoes-mes
 * Dispara o fechamento manualmente (teste e plano B se o job falhar).
 * Aceita { mes_referencia: 'YYYY-MM-DD' } no body pra refazer um mês anterior;
 * sem isso, usa o mês corrente.
 */
const fecharComissoesManualmente = async (req, res) => {
  try {
    const mesInformado = req.body && req.body.mes_referencia;
    if (mesInformado && !/^\d{4}-\d{2}-\d{2}$/.test(mesInformado)) {
      return res.status(400).json({ erro: 'mes_referencia deve estar no formato YYYY-MM-DD' });
    }
    const resumo = await fecharComissoesDoMes(mesInformado || null);
    res.json({ mensagem: 'Fechamento executado.', ...resumo });
  } catch (erro) {
    console.error('Erro no fechamento manual de comissões:', erro);
    res.status(500).json({ erro: 'Erro ao fechar comissões: ' + erro.message });
  }
};

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
  solicitarInstitucional,
  sincronizarIndicacaoDoUsuario,
  registrarIndicacaoSeAplicavel,
  resolverParceiroPorCodigo,
  fecharComissoesDoMes,
  fecharComissoesManualmente,
  verificarMetasAtingidas,
  valorComissaoUnitaria,
  FAIXAS_INSTITUCIONAL,
  primeiroDiaDoMes,
  LINK_BASE_PARCEIRO
};
