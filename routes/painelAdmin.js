const express = require('express');
const router = express.Router();
const { obterPainel, listarUsuarios } = require('../controllers/painelAdminController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.use(autenticar, verificarAdmin);
router.get('/', obterPainel);
router.get('/usuarios', listarUsuarios);

module.exports = router;
