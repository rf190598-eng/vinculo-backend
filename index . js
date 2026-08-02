
const Denuncia = require('./models/Denuncia');
const Bloqueio = require('./models/Bloqueio');
const recuperacaoSenhaRoutes = require('./routes/recuperacaoSenha');
const denunciaRoutes = require('./routes/denuncia');
const bloqueioRoutes = require('./routes/bloqueio');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();
const { conectarBanco, sequelize } = require('./database');
const Usuario = require('./models/Usuario');
const Swipe = require('./models/Swipe');
const Match = require('./models/Match');
const Mensagem = require('./models/Mensagem');
const ContatoConfianca = require('./models/ContatoConfianca');
const AlertaSeguranca = require('./models/AlertaSeguranca');
const SessaoSeguranca = require('./models/SessaoSeguranca');
const Evento = require('./models/Evento');
const EventoConfirmacao = require('./models/EventoConfirmacao');
const SolicitacaoParceria = require('./models/SolicitacaoParceria');
const Dupla = require('./models/Dupla');
const DuplaAvaliacao = require('./models/DuplaAvaliacao');
const DuplaMatch = require('./models/DuplaMatch');
const MensagemDupla = require('./models/MensagemDupla');
const StatusResposta = require('./models/StatusResposta');
const VisualizacaoPerfil = require('./models/VisualizacaoPerfil');
const Notificacao = require('./models/Notificacao');
const AvaliacaoEncontro = require('./models/AvaliacaoEncontro');
const FotoPerfil = require('./models/FotoPerfil');
const UsoRekognition = require('./models/UsoRekognition');
const authRoutes = require('./routes/auth');
const swipeRoutes = require('./routes/swipe');
const chatRoutes = require('./routes/chat');
const perfilRoutes = require('./routes/perfil');
const livenessRoutes = require('./routes/livenessRoutes');
const pagamentoRoutes = require('./routes/pagamento');
const segurancaRoutes = require('./routes/seguranca');
const eventosRoutes = require('./routes/eventos');
const parceriaRoutes = require('./routes/parceria');
const duplaRoutes = require('./routes/dupla');
const statusRoutes = require('./routes/status');
const estatisticasRoutes = require('./routes/estatisticas');
const { verificarCheckinsVencidos } = require('./controllers/segurancaController');

const app = express();
const PORT = process.env.PORT || 3000;

// Necessário no Railway (está atrás de proxy) para IP real funcionar
// corretamente no rate limiting e nos logs de segurança
app.set('trust proxy', 1);

// ===== SEGURANÇA: CORS restrito =====
// Em produção, ajuste a lista abaixo para os domínios reais do app/site.
// Enquanto não tiver domínio definitivo, pode usar variável de ambiente.
const origensPermitidas = process.env.ORIGENS_PERMITIDAS
  ? process.env.ORIGENS_PERMITIDAS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? origensPermitidas : '*',
  credentials: true
}));

// ===== SEGURANÇA: Headers de segurança =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // necessário para servir imagens de /uploads
  contentSecurityPolicy: false // o prototipo.html usa script/onclick inline; CSP padrão bloqueava tudo
}));

// ===== SEGURANÇA: Limite de tamanho de payload (evita DoS por payload gigante) =====
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ===== SEGURANÇA: Rate limiting geral =====
const limiteGeral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiteGeral);

// ===== SEGURANÇA: Rate limiting mais restrito para autenticação (evita brute-force) =====
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas de login/registro. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth', limiteAuth);

app.get('/prototipo', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'prototipo.html'));
});
app.get('/vinculo-liveness-bundle.mjs', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'vinculo-liveness-bundle.mjs'));
});

// ===== ATENÇÃO: /uploads público =====
// Fotos de perfil podem ficar aqui (são públicas por natureza do produto).
// Fotos de verificação de identidade/documento NÃO devem ser servidas por aqui.
// Elas devem ter uma rota própria e autenticada em algum dos routers acima
// (ex: perfilRoutes) que verifica permissão antes de entregar o arquivo.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'online', app: 'Vinculo Backend', versao: '1.0.0', mensagem: 'Servidor funcionando!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', recuperacaoSenhaRoutes);
app.use('/api/swipe', swipeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/perfil', perfilRoutes);
app.use('/api/perfil/liveness', livenessRoutes);
app.use('/api/pagamento', pagamentoRoutes);
app.use('/api/seguranca', segurancaRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/parceria', parceriaRoutes);
app.use('/api/dupla', duplaRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/estatisticas', estatisticasRoutes);
app.use('/api/denuncia', denunciaRoutes);
app.use('/api/bloqueio', bloqueioRoutes);

// ===== Rota não encontrada =====
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

// ===== Tratamento de erro global =====
// Precisa ficar por último. Captura qualquer erro não tratado nas rotas
// e evita que o processo caia ou vaze detalhes internos ao usuário.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const mensagensMulter = {
      LIMIT_FILE_SIZE: 'Essa foto é grande demais. Envie uma imagem de até 10MB.'
    };
    return res.status(400).json({ erro: mensagensMulter[err.code] || 'Erro no envio do arquivo: ' + err.message });
  }
  console.error('Erro não tratado:', err.stack);
  res.status(err.status || 500).json({
    erro: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message
  });
});

let servidor;

const iniciar = async () => {
  await conectarBanco();
  await sequelize.sync({ alter: true }); // TODO: trocar por migrations antes do lançamento
  console.log('Tabelas sincronizadas!');

  servidor = app.listen(PORT, () => {
    console.log('Servidor Vinculo rodando na porta ' + PORT);
    console.log('Acesse: http://localhost:' + PORT);
  });

  // setInterval com tratamento de erro para não derrubar o processo silenciosamente
  setInterval(() => {
    verificarCheckinsVencidos().catch((err) => {
      console.error('Erro ao verificar check-ins vencidos:', err);
    });
  }, 60 * 1000);
};

// ===== Graceful shutdown =====
// Garante que, ao reiniciar/deployar no Railway, o servidor termina
// conexões em andamento (chat, upload, etc) antes de encerrar.
const encerrarComEducacao = async (sinal) => {
  console.log(`Recebido ${sinal}. Encerrando servidor com educação...`);
  if (servidor) {
    servidor.close(async () => {
      console.log('Servidor HTTP fechado.');
      await sequelize.close();
      console.log('Conexão com banco fechada.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => encerrarComEducacao('SIGTERM'));
process.on('SIGINT', () => encerrarComEducacao('SIGINT'));

iniciar();
