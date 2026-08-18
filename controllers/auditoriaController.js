const { Op } = require('sequelize');
const LogAuditoria = require('../models/LogAuditoria');

// Ponto único de gravação do log de auditoria. Toda ação administrativa
// sensível criada a partir do Lote 0 chama esta função DEPOIS de executar
// a ação com sucesso.
//
// Decisão de propósito: se a gravação do log falhar, a ação em si (que já
// aconteceu) não é desfeita nem a resposta ao admin é bloqueada — só
// registra o erro no console. Um log de auditoria existe pra dar
// transparência sobre ações já realizadas; travar a ação por causa de uma
// falha de log criaria uma inconsistência pior (ex: recusar uma exclusão
// de conta que o usuário pediu, só porque a escrita do log engasgou).
//
// admin: { id, nome, email } — normalmente req.usuarioAdmin (anexado pelo
// middleware verificarAdmin).
// usuarioAlvo: { id, nome, email } ou null, quando a ação não mira um
// usuário específico.
// detalhes: objeto livre (serializado como JSONB) com o que for específico
// da ação — ex: { campo: 'telefone', de: '...', para: '...' }.
async function registrarLogAuditoria({ admin, acao, usuarioAlvo, detalhes }) {
  try {
    await LogAuditoria.create({
      admin_id: admin.id,
      admin_nome: admin.nome,
      admin_email: admin.email,
      acao,
      usuario_alvo_id: usuarioAlvo ? usuarioAlvo.id : null,
      usuario_alvo_nome: usuarioAlvo ? usuarioAlvo.nome : null,
      usuario_alvo_email: usuarioAlvo ? usuarioAlvo.email : null,
      detalhes: detalhes || null
    });
  } catch (erro) {
    console.error('Falha ao registrar log de auditoria (ação já executada, log não foi salvo):', erro);
  }
}

const PAGINA_TAMANHO_PADRAO = 25;
const PAGINA_TAMANHO_MAXIMO = 100;

// GET /api/admin/painel/logs-auditoria?pagina=&por_pagina=&acao=&usuario_alvo_id=
const listarLogsAuditoria = async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = Math.min(
      PAGINA_TAMANHO_MAXIMO,
      Math.max(1, parseInt(req.query.por_pagina, 10) || PAGINA_TAMANHO_PADRAO)
    );

    const where = {};
    if (req.query.acao) {
      where.acao = String(req.query.acao).trim().slice(0, 100);
    }
    if (req.query.usuario_alvo_id) {
      where.usuario_alvo_id = String(req.query.usuario_alvo_id).trim();
    }

    const { count, rows } = await LogAuditoria.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: porPagina,
      offset: (pagina - 1) * porPagina
    });

    res.json({
      logs: rows.map(l => ({
        id: l.id,
        admin_nome: l.admin_nome,
        admin_email: l.admin_email,
        acao: l.acao,
        usuario_alvo_id: l.usuario_alvo_id,
        usuario_alvo_nome: l.usuario_alvo_nome,
        usuario_alvo_email: l.usuario_alvo_email,
        detalhes: l.detalhes,
        criado_em: l.createdAt
      })),
      total: count,
      pagina,
      por_pagina: porPagina,
      total_paginas: Math.max(1, Math.ceil(count / porPagina))
    });
  } catch (erro) {
    console.error('Erro ao listar logs de auditoria:', erro);
    res.status(500).json({ erro: 'Erro ao listar logs de auditoria' });
  }
};

module.exports = { registrarLogAuditoria, listarLogsAuditoria };
