const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const Parceiro = require('../models/Parceiro');
const Indicacao = require('../models/Indicacao');
const Comissao = require('../models/Comissao');
const BonusMeta = require('../models/BonusMeta');
const { verificarMetasAtingidas } = require('./parceiroController');

// Valores aceitos em parceiros.status. 'rejeitado' foi acrescentado agora,
// para o fluxo de aprovação institucional do painel — a coluna é STRING (não
// enum no banco), então basta validar aqui e manter esta lista como a fonte
// de verdade do que é permitido.
const STATUS_PARCEIRO_VALIDOS = ['ativo', 'pendente_aprovacao', 'suspenso', 'rejeitado'];
const TIPOS_PARCEIRO_VALIDOS = ['individual', 'institucional'];

/**
 * GET /api/admin/parceiros?tipo=&status=
 * Lista parceiros com o nome/email do usuário dono e a contagem de indicações.
 */
const listarParceiros = async (req, res) => {
  try {
    const { tipo, status } = req.query;
    const where = {};
    if (tipo && TIPOS_PARCEIRO_VALIDOS.includes(tipo)) where.tipo = tipo;
    if (status && STATUS_PARCEIRO_VALIDOS.includes(status)) where.status = status;

    const parceiros = await Parceiro.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 500
    });

    if (!parceiros.length) return res.json({ parceiros: [] });

    // Busca em lote em vez de uma consulta por linha.
    const usuarios = await Usuario.findAll({
      where: { id: { [Op.in]: parceiros.map(p => p.usuario_id) } },
      attributes: ['id', 'nome', 'email']
    });
    const mapaUsuarios = new Map(usuarios.map(u => [u.id, u]));

    const indicacoes = await Indicacao.findAll({
      where: { parceiro_id: { [Op.in]: parceiros.map(p => p.id) } },
      attributes: ['parceiro_id', 'status']
    });
    const contagem = new Map();
    for (const ind of indicacoes) {
      const atual = contagem.get(ind.parceiro_id) || { total: 0, ativas: 0 };
      atual.total++;
      if (ind.status === 'ativo') atual.ativas++;
      contagem.set(ind.parceiro_id, atual);
    }

    res.json({
      parceiros: parceiros.map(p => {
        const usuario = mapaUsuarios.get(p.usuario_id);
        const c = contagem.get(p.id) || { total: 0, ativas: 0 };
        return {
          id: p.id,
          nome: usuario ? usuario.nome : '(usuário removido)',
          email: usuario ? usuario.email : null,
          tipo: p.tipo,
          codigo_indicacao: p.codigo_indicacao,
          status: p.status,
          nome_instituicao: p.nome_instituicao,
          chave_pix: p.chave_pix,
          comissao_base: Number(p.comissao_base || 0),
          data_aprovacao: p.data_aprovacao,
          createdAt: p.createdAt,
          total_indicacoes: c.total,
          indicacoes_ativas: c.ativas
        };
      })
    });
  } catch (erro) {
    console.error('Erro ao listar parceiros:', erro);
    res.status(500).json({ erro: 'Erro ao listar parceiros: ' + erro.message });
  }
};

/**
 * PATCH /api/admin/parceiros/:id/status
 * Body: { status: 'ativo' | 'rejeitado' | 'suspenso' | 'pendente_aprovacao' }
 *
 * Um endpoint só em vez de /aprovar e /rejeitar separados: a operação é a
 * mesma (mudar status), e assim suspender/reabilitar já vem de graça.
 * data_aprovacao é preenchida na primeira vez que vira 'ativo' e nunca é
 * apagada depois — é registro histórico de quando foi aprovado.
 */
const atualizarStatusParceiro = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!STATUS_PARCEIRO_VALIDOS.includes(status)) {
      return res.status(400).json({
        erro: 'Status inválido. Use: ' + STATUS_PARCEIRO_VALIDOS.join(', ')
      });
    }

    const parceiro = await Parceiro.findByPk(id);
    if (!parceiro) return res.status(404).json({ erro: 'Parceiro não encontrado' });

    const atualizacao = { status };
    if (status === 'ativo' && !parceiro.data_aprovacao) {
      atualizacao.data_aprovacao = new Date();
    }

    await parceiro.update(atualizacao);
    res.json({ mensagem: 'Status atualizado.', id: parceiro.id, status: parceiro.status, data_aprovacao: parceiro.data_aprovacao });
  } catch (erro) {
    console.error('Erro ao atualizar status do parceiro:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar status: ' + erro.message });
  }
};

/**
 * GET /api/admin/comissoes?status_pagamento=&mes_referencia=
 * Devolve as comissões e, sempre, o total pendente GERAL (não filtrado) —
 * é o número de "quanto tenho a pagar agora", que não pode mudar conforme
 * o filtro da tela.
 */
const listarComissoes = async (req, res) => {
  try {
    const { status_pagamento, mes_referencia } = req.query;
    const where = {};
    if (status_pagamento === 'pendente' || status_pagamento === 'pago') {
      where.status_pagamento = status_pagamento;
    }
    if (mes_referencia && /^\d{4}-\d{2}-\d{2}$/.test(mes_referencia)) {
      where.mes_referencia = mes_referencia;
    }

    const comissoes = await Comissao.findAll({
      where,
      order: [['mes_referencia', 'DESC'], ['createdAt', 'DESC']],
      limit: 1000
    });

    // Total pendente global, independente dos filtros aplicados na listagem.
    const totalPendente = await Comissao.sum('valor', { where: { status_pagamento: 'pendente' } });

    // Meses disponíveis, pra montar o filtro na tela sem hardcode.
    const todosMeses = await Comissao.findAll({
      attributes: ['mes_referencia'],
      group: ['mes_referencia'],
      order: [['mes_referencia', 'DESC']]
    });

    let linhas = [];
    if (comissoes.length) {
      const parceiros = await Parceiro.findAll({
        where: { id: { [Op.in]: comissoes.map(c => c.parceiro_id) } },
        attributes: ['id', 'usuario_id', 'codigo_indicacao', 'chave_pix']
      });
      const mapaParceiros = new Map(parceiros.map(p => [p.id, p]));

      const usuarios = await Usuario.findAll({
        where: { id: { [Op.in]: parceiros.map(p => p.usuario_id) } },
        attributes: ['id', 'nome']
      });
      const mapaUsuarios = new Map(usuarios.map(u => [u.id, u]));

      linhas = comissoes.map(c => {
        const parceiro = mapaParceiros.get(c.parceiro_id);
        const usuario = parceiro ? mapaUsuarios.get(parceiro.usuario_id) : null;
        return {
          id: c.id,
          parceiro_id: c.parceiro_id,
          parceiro_nome: usuario ? usuario.nome : '(parceiro removido)',
          codigo_indicacao: parceiro ? parceiro.codigo_indicacao : null,
          chave_pix: parceiro ? parceiro.chave_pix : null,
          mes_referencia: c.mes_referencia,
          valor: Number(c.valor || 0),
          status_pagamento: c.status_pagamento,
          data_pagamento: c.data_pagamento
        };
      });
    }

    res.json({
      comissoes: linhas,
      total_pendente: Number(totalPendente || 0),
      meses_disponiveis: todosMeses.map(m => m.mes_referencia)
    });
  } catch (erro) {
    console.error('Erro ao listar comissões:', erro);
    res.status(500).json({ erro: 'Erro ao listar comissões: ' + erro.message });
  }
};

/**
 * PATCH /api/admin/comissoes/:id/marcar-pago
 * Idempotente: marcar de novo uma comissão já paga não muda data_pagamento
 * (o registro de quando foi pago não pode ser sobrescrito por engano).
 */
const marcarComissaoPaga = async (req, res) => {
  try {
    const { id } = req.params;
    const comissao = await Comissao.findByPk(id);
    if (!comissao) return res.status(404).json({ erro: 'Comissão não encontrada' });

    if (comissao.status_pagamento === 'pago') {
      return res.json({
        mensagem: 'Esta comissão já estava marcada como paga.',
        id: comissao.id,
        status_pagamento: comissao.status_pagamento,
        data_pagamento: comissao.data_pagamento
      });
    }

    await comissao.update({ status_pagamento: 'pago', data_pagamento: new Date() });
    res.json({
      mensagem: 'Comissão marcada como paga.',
      id: comissao.id,
      status_pagamento: comissao.status_pagamento,
      data_pagamento: comissao.data_pagamento
    });
  } catch (erro) {
    console.error('Erro ao marcar comissão como paga:', erro);
    res.status(500).json({ erro: 'Erro ao marcar como paga: ' + erro.message });
  }
};

/**
 * GET /api/admin/metas
 * Lista as metas com progresso calculado na hora (indicações ativas do
 * parceiro vs meta) e prazo restante. O progresso NÃO é armazenado — sai
 * sempre de indicacoes, pra não existirem dois lugares dizendo quantos são.
 */
const listarMetas = async (req, res) => {
  try {
    const metas = await BonusMeta.findAll({ order: [['createdAt', 'DESC']], limit: 300 });
    if (!metas.length) return res.json({ metas: [] });

    const idsParceiros = [...new Set(metas.map(m => m.parceiro_id))];
    const parceiros = await Parceiro.findAll({
      where: { id: { [Op.in]: idsParceiros } },
      attributes: ['id', 'usuario_id', 'nome_instituicao', 'tipo']
    });
    const mapaParceiros = new Map(parceiros.map(p => [p.id, p]));

    const usuarios = await Usuario.findAll({
      where: { id: { [Op.in]: parceiros.map(p => p.usuario_id) } },
      attributes: ['id', 'nome']
    });
    const mapaUsuarios = new Map(usuarios.map(u => [u.id, u]));

    const ativas = await Indicacao.findAll({
      where: { parceiro_id: { [Op.in]: idsParceiros }, status: 'ativo' },
      attributes: ['parceiro_id']
    });
    const contagem = new Map();
    for (const ind of ativas) {
      contagem.set(ind.parceiro_id, (contagem.get(ind.parceiro_id) || 0) + 1);
    }

    const agora = Date.now();
    res.json({
      metas: metas.map(m => {
        const parceiro = mapaParceiros.get(m.parceiro_id);
        const usuario = parceiro ? mapaUsuarios.get(parceiro.usuario_id) : null;
        const fim = new Date(m.data_inicio).getTime() + m.prazo_dias * 24 * 60 * 60 * 1000;
        const diasRestantes = Math.ceil((fim - agora) / (24 * 60 * 60 * 1000));
        const progresso = contagem.get(m.parceiro_id) || 0;
        return {
          id: m.id,
          parceiro_id: m.parceiro_id,
          parceiro_nome: parceiro && parceiro.nome_instituicao
            ? parceiro.nome_instituicao
            : (usuario ? usuario.nome : '(parceiro removido)'),
          meta_usuarios: m.meta_usuarios,
          progresso,
          prazo_dias: m.prazo_dias,
          data_inicio: m.data_inicio,
          dias_restantes: diasRestantes,
          // 'atingida' | 'em_andamento' | 'expirada'
          situacao: m.atingida ? 'atingida' : (diasRestantes < 0 ? 'expirada' : 'em_andamento'),
          valor_bonus: Number(m.valor_bonus || 0),
          atingida: m.atingida,
          data_atingida: m.data_atingida
        };
      })
    });
  } catch (erro) {
    console.error('Erro ao listar metas:', erro);
    res.status(500).json({ erro: 'Erro ao listar metas: ' + erro.message });
  }
};

/**
 * POST /api/admin/metas
 * Body: { parceiro_id, meta_usuarios, prazo_dias, valor_bonus }
 */
const criarMeta = async (req, res) => {
  try {
    const { parceiro_id, meta_usuarios, prazo_dias, valor_bonus } = req.body || {};

    const metaUsuarios = parseInt(meta_usuarios, 10);
    const prazoDias = parseInt(prazo_dias, 10);
    const valorBonus = Number(valor_bonus);

    if (!parceiro_id) return res.status(400).json({ erro: 'Informe o parceiro' });
    if (!Number.isFinite(metaUsuarios) || metaUsuarios < 1) {
      return res.status(400).json({ erro: 'meta_usuarios deve ser um número maior que zero' });
    }
    if (!Number.isFinite(prazoDias) || prazoDias < 1) {
      return res.status(400).json({ erro: 'prazo_dias deve ser um número maior que zero' });
    }
    if (!Number.isFinite(valorBonus) || valorBonus <= 0) {
      return res.status(400).json({ erro: 'valor_bonus deve ser maior que zero' });
    }

    const parceiro = await Parceiro.findByPk(parceiro_id);
    if (!parceiro) return res.status(404).json({ erro: 'Parceiro não encontrado' });

    const meta = await BonusMeta.create({
      parceiro_id,
      meta_usuarios: metaUsuarios,
      prazo_dias: prazoDias,
      valor_bonus: valorBonus,
      data_inicio: new Date(),
      atingida: false
    });

    res.status(201).json({ mensagem: 'Meta criada.', id: meta.id });
  } catch (erro) {
    console.error('Erro ao criar meta:', erro);
    res.status(500).json({ erro: 'Erro ao criar meta: ' + erro.message });
  }
};

/**
 * POST /api/admin/metas/verificar
 * Dispara a verificação de metas na hora, sem esperar o job horário.
 */
const verificarMetasManualmente = async (req, res) => {
  try {
    const resumo = await verificarMetasAtingidas();
    res.json({ mensagem: 'Verificação executada.', ...resumo });
  } catch (erro) {
    console.error('Erro ao verificar metas:', erro);
    res.status(500).json({ erro: 'Erro ao verificar metas: ' + erro.message });
  }
};

module.exports = {
  listarParceiros,
  atualizarStatusParceiro,
  listarComissoes,
  marcarComissaoPaga,
  listarMetas,
  criarMeta,
  verificarMetasManualmente,
  STATUS_PARCEIRO_VALIDOS
};
