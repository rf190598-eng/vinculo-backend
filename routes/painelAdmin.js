const express = require('express');
const router = express.Router();
const {
  obterPainel,
  listarUsuarios,
  obterRankingComissoes,
  obterSegmentacaoPagantes
} = require('../controllers/painelAdminController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.use(autenticar, verificarAdmin);
router.get('/', obterPainel);
router.get('/usuarios', listarUsuarios);
router.get('/ranking-comissoes', obterRankingComissoes);
router.get('/segmentacao-pagantes', obterSegmentacaoPagantes);

module.exports = router;
