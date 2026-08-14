const express = require('express');
const router = express.Router();
const { meuParceiro, solicitarInstitucional, fecharComissoesManualmente } = require('../controllers/parceiroController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

// Auto-provisiona o parceiro na primeira chamada (ver parceiroController).
router.get('/me', autenticar, meuParceiro);
router.post('/solicitar-institucional', autenticar, solicitarInstitucional);

// ===== Administrativo =====
// Montado aqui e exposto em /api/admin/parceiros (ver index.js), pra manter a
// separação clara entre o que é do parceiro e o que é do administrador.
// verificarAdmin já existe no projeto e checa usuarios.is_admin — mesmo
// middleware usado em denúncias, eventos, parcerias e estatísticas.
const {
  listarParceiros,
  atualizarStatusParceiro,
  listarComissoes,
  marcarComissaoPaga,
  listarMetas,
  criarMeta,
  verificarMetasManualmente,
  testarLembretePagamento // TEMPORÁRIO — remover junto com a rota abaixo
} = require('../controllers/adminParceiroController');

// Montado em /api/admin/parceiros
const rotasAdmin = express.Router();
rotasAdmin.use(autenticar, verificarAdmin); // tudo aqui exige admin
rotasAdmin.get('/', listarParceiros);
rotasAdmin.patch('/:id/status', atualizarStatusParceiro);
rotasAdmin.post('/fechar-comissoes-mes', fecharComissoesManualmente);

// ⚠️ TEMPORÁRIO — REMOVER DEPOIS DE CONFIRMAR QUE O E-MAIL CHEGA ⚠️
// Dispara o lembrete de pagamento das comissões na hora, sem esperar o dia 3.
rotasAdmin.post('/testar-lembrete', testarLembretePagamento);

// Montado em /api/admin/comissoes
const rotasAdminComissoes = express.Router();
rotasAdminComissoes.use(autenticar, verificarAdmin);
rotasAdminComissoes.get('/', listarComissoes);
rotasAdminComissoes.patch('/:id/marcar-pago', marcarComissaoPaga);

// Montado em /api/admin/metas
const rotasAdminMetas = express.Router();
rotasAdminMetas.use(autenticar, verificarAdmin);
rotasAdminMetas.get('/', listarMetas);
rotasAdminMetas.post('/', criarMeta);
rotasAdminMetas.post('/verificar', verificarMetasManualmente);

module.exports = { router, rotasAdmin, rotasAdminComissoes, rotasAdminMetas };
