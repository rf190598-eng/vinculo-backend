const express = require('express');
const router = express.Router();
const {
  registrarVisualizacao, obterMinhasEstatisticas,
  listarNotificacoes, marcarNotificacoesLidas,
  obterEstatisticasAdmin
} = require('../controllers/estatisticasController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/visualizacao', autenticar, registrarVisualizacao);
router.get('/minhas', autenticar, obterMinhasEstatisticas);
router.get('/notificacoes', autenticar, listarNotificacoes);
router.put('/notificacoes/marcar-lidas', autenticar, marcarNotificacoesLidas);
router.get('/admin', autenticar, obterEstatisticasAdmin);

module.exports = router;
