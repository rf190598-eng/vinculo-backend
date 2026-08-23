const express = require('express');
const router = express.Router();
const { inscrever, desinscrever, chavePublica } = require('../controllers/pushController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');

router.get('/chave-publica', chavePublica);
router.post('/inscrever', autenticar, limitarTaxa({ chave: 'push-inscrever', porUsuario: true, janelaMs: 60 * 60 * 1000, maxTentativas: 50 }), inscrever);
router.delete('/inscrever', autenticar, desinscrever);

module.exports = router;
