const express = require('express');
const router = express.Router();
const { listarEventos, criarEvento, confirmarPresenca } = require('../controllers/eventoController');
const { autenticar } = require('../controllers/authMiddleware');

router.get('/', autenticar, listarEventos);
router.post('/', autenticar, criarEvento);
router.post('/:evento_id/confirmar', autenticar, confirmarPresenca);

module.exports = router;
