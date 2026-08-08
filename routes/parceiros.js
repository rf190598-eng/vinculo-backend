const express = require('express');
const router = express.Router();
const { meuParceiro } = require('../controllers/parceiroController');
const { autenticar } = require('../controllers/authMiddleware');

// Auto-provisiona o parceiro na primeira chamada (ver parceiroController).
router.get('/me', autenticar, meuParceiro);

module.exports = router;
