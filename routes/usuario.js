const express = require('express');
const router = express.Router();
const { excluirConta } = require('../controllers/contaController');
const { autenticar } = require('../controllers/authMiddleware');

router.delete('/conta', autenticar, excluirConta);

module.exports = router;
