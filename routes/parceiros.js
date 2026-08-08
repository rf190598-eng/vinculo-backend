const express = require('express');
const router = express.Router();
const { meuParceiro, fecharComissoesManualmente } = require('../controllers/parceiroController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

// Auto-provisiona o parceiro na primeira chamada (ver parceiroController).
router.get('/me', autenticar, meuParceiro);

// ===== Administrativo =====
// Montado aqui e exposto em /api/admin/parceiros (ver index.js), pra manter a
// separação clara entre o que é do parceiro e o que é do administrador.
// verificarAdmin já existe no projeto e checa usuarios.is_admin — mesmo
// middleware usado em denúncias, eventos, parcerias e estatísticas.
const rotasAdmin = express.Router();
rotasAdmin.post('/fechar-comissoes-mes', autenticar, verificarAdmin, fecharComissoesManualmente);

module.exports = { router, rotasAdmin };
