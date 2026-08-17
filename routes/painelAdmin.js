const express = require('express');
const router = express.Router();
const { obterPainel } = require('../controllers/painelAdminController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.use(autenticar, verificarAdmin);
router.get('/', obterPainel);

module.exports = router;
