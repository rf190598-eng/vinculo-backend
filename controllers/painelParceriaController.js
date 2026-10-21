const SolicitacaoParceria = require('../models/SolicitacaoParceria');
const Usuario = require('../models/Usuario');
const { registrarLogAuditoria } = require('./auditoriaController');

const STATUS_VALIDOS = ['pendente', 'aprovado', 'recusado'];

// GET /api/admin/painel/solicitacoes-parceria
// Lista os pedidos de espaço/evento enviados pelo formulário "Ser Parceiro" do app,
// com os dados de quem enviou. Somente leitura.
const listarSolicitacoesParceria = async (req, res) => {
  try {
    const solicitacoes = await SolicitacaoParceria.findAll({ order: [['createdAt', 'DESC']], limit: 500 });

    const ids = [...new Set(solicitacoes.map(s => s.usuario_id).filter(Boolean))];
    const usuarios = ids.length
      ? await Usuario.findAll({ where: { id: ids }, attributes: ['id', 'nome', 'email'] })
      : [];
    const porId = {};
    usuarios.forEach(u => { porId[u.id] = u; });

    const lista = solicitacoes.map(s => {
      const u = s.usuario_id ? porId[s.usuario_id] : null;
      return {
        id: s.id,
        nome_espaco: s.nome_espaco,
        tipo_negocio: s.tipo_negocio,
        endereco: s.endereco,
        bairro: s.bairro,
        telefone: s.telefone,
        instagram: s.instagram,
        descricao: s.descricao,
        funcionamento: s.funcionamento,
        horario: s.horario,
        valor_entrada: s.valor_entrada,
        tipo_anuncio: s.tipo_anuncio,
        status: s.status,
        criado_em: s.createdAt,
        solicitante_nome: u ? u.nome : null,
        solicitante_email: u ? u.email : null
      };
    });

    const resumo = {
      total: lista.length,
      pendentes: lista.filter(s => s.status === 'pendente').length,
      aprovados: lista.filter(s => s.status === 'aprovado').length,
      recusados: lista.filter(s => s.status === 'recusado').length,
      destaque_pago: lista.filter(s => s.tipo_anuncio === 'destaque').length
    };

    res.json({ resumo, solicitacoes: lista });
  } catch (erro) {
    console.error('Erro ao listar solicitações de parceria:', erro);
    res.status(500).json({ erro: 'Erro ao listar solicitações de parceria.' });
  }
};

// PATCH /api/admin/painel/solicitacoes-parceria/:id   body: { status }
const atualizarStatusSolicitacao = async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    if (!STATUS_VALIDOS.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }
    const solicitacao = await SolicitacaoParceria.findByPk(req.params.id);
    if (!solicitacao) return res.status(404).json({ erro: 'Solicitação não encontrada.' });

    const anterior = solicitacao.status;
    solicitacao.status = status;
    await solicitacao.save();

    await registrarLogAuditoria({
      admin: req.usuarioAdmin,
      acao: 'solicitacao_parceria_status',
      usuarioAlvo: null,
      detalhes: { solicitacao_id: solicitacao.id, nome_espaco: solicitacao.nome_espaco, de: anterior, para: status }
    });

    res.json({ mensagem: 'Status atualizado.', status });
  } catch (erro) {
    console.error('Erro ao atualizar solicitação de parceria:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar a solicitação.' });
  }
};

module.exports = { listarSolicitacoesParceria, atualizarStatusSolicitacao };
