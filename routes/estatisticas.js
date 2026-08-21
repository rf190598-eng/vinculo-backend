const express = require('express');
const router = express.Router();
const {
  registrarVisualizacao, obterMinhasEstatisticas, listarVisitantesPerfil,
  listarNotificacoes, marcarNotificacoesLidas,
  obterEstatisticasAdmin
} = require('../controllers/estatisticasController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/visualizacao', autenticar, registrarVisualizacao);
router.get('/minhas', autenticar, obterMinhasEstatisticas);
router.get('/visitantes', autenticar, listarVisitantesPerfil);
router.get('/notificacoes', autenticar, listarNotificacoes);
router.put('/notificacoes/marcar-lidas', autenticar, marcarNotificacoesLidas);
const { verificarAdmin } = require('../controllers/verificarAdmin');
router.get('/admin', autenticar, verificarAdmin, obterEstatisticasAdmin);

module.exports = router;
