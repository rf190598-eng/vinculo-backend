const express = require('express');
const router = express.Router();
const { criarDenuncia, listarDenuncias, atualizarStatusDenuncia } = require('../controllers/denunciaController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.post('/', autenticar, criarDenuncia);

router.get('/', autenticar, verificarAdmin, listarDenuncias);
router.patch('/:id', autenticar, verificarAdmin, atualizarStatusDenuncia);

module.exports = router;