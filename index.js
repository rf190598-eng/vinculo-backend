
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
const Parceiro = require('./models/Parceiro');
const Indicacao = require('./models/Indicacao');
const Comissao = require('./models/Comissao');
const BonusMeta = require('./models/BonusMeta');
const { registrarAssociacoes } = require('./models/associacoes');
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
const usuarioRoutes = require('./routes/usuario');
const {
  router: parceiroRoutes,
  rotasAdmin: parceiroRotasAdmin,
  rotasAdminComissoes
} = require('./routes/parceiros');
const { fecharComissoesDoMes, primeiroDiaDoMes } = require('./controllers/parceiroController');
const { verificarCheckinsVencidos } = require('./controllers/segurancaController');
const { verificarAssinaturasVencidas } = require('./controllers/pagamentoController');

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

// Link curto de parceiro: /r/CODIGO -> abre o app já com o ref na query.
// É o que faz o link divulgado (app.vinculoapp.com.br/r/pmaria1234) funcionar
// de verdade — sem isso, o link seria só um texto bonito que dá 404.
app.get('/r/:codigo', (req, res) => {
  const codigo = String(req.params.codigo || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  res.redirect(302, '/prototipo?ref=' + encodeURIComponent(codigo));
});

app.get('/prototipo', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'prototipo.html'));
});

// Painel administrativo do Programa de Parceiros. Serve só o HTML — todo o
// controle de acesso é feito pelas rotas /api/admin/*, que exigem token com
// is_admin. Servir a página é inofensivo: sem token válido ela não carrega dado.
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'admin.html'));
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
app.use('/api/usuario', usuarioRoutes);
app.use('/api/parceiros', parceiroRoutes);
app.use('/api/admin/parceiros', parceiroRotasAdmin);
app.use('/api/admin/comissoes', rotasAdminComissoes);

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

  // Antes do sync: declarar as associações não mexe no banco, só ensina ao
  // Sequelize como os models se relacionam (habilita include/eager loading).
  registrarAssociacoes();

  // ===== SEGURANÇA DE DADOS: alter:true só em desenvolvimento =====
  // sequelize.sync({ alter: true }) muda o schema do banco automaticamente
  // toda vez que o servidor sobe. Ótimo pra prototipar sozinho, perigoso
  // rodando direto em produção com usuários reais (pode travar em tabelas
  // grandes ou, em certas mudanças de coluna, perder dado). Antes do
  // lançamento público, isso deve virar migrations reais (sequelize-cli).
  if (process.env.NODE_ENV === 'production') {
    await sequelize.sync(); // cria tabelas que não existem, mas NÃO altera as existentes
    console.log('Sync em modo produção (sem alter). Use migrations pra mudar o schema.');
  } else {
    await sequelize.sync({ alter: true }); // TODO: trocar por migrations antes do lançamento
    console.log('Tabelas sincronizadas (modo desenvolvimento, com alter)!');
  }

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

  // Assinaturas vencidas: os pagamentos são PIX avulsos, então o Mercado Pago
  // NUNCA avisa quando os dias comprados acabam — não existe assinatura do
  // lado dele pra vencer. Sem esta varredura, quem pagou uma vez continuaria
  // contando como indicado ativo para sempre e geraria comissão indevida.
  // Roda de hora em hora (não 1x/dia) pra que a janela de erro seja curta,
  // e uma vez na subida pra recuperar o tempo em que o processo esteve fora.
  const UMA_HORA = 60 * 60 * 1000;
  const rodarVerificacaoAssinaturas = () => {
    verificarAssinaturasVencidas().catch((err) => {
      console.error('Erro ao verificar assinaturas vencidas:', err);
    });
  };
  rodarVerificacaoAssinaturas();
  setInterval(rodarVerificacaoAssinaturas, UMA_HORA);

  // Fechamento mensal de comissões do Programa de Parceiros.
  //
  // Não é um agendamento "dia 1 à meia-noite": o processo pode estar fora do
  // ar exatamente nesse instante (deploy, restart do Railway) e o mês seria
  // pulado. Em vez disso roda de hora em hora e pergunta "o mês corrente já
  // foi fechado?" — na primeira execução depois da virada, fecha; nas demais,
  // o próprio fecharComissoesDoMes é idempotente e não cria nada.
  //
  // A guarda em memória (ultimoMesFechado) evita só o trabalho repetido de
  // consultar o banco a cada hora; a garantia real contra duplicidade é o
  // índice único uq_comissoes_indicacao_mes, que sobrevive a restart.
  let ultimoMesFechado = null;
  const rodarFechamentoMensal = async () => {
    const mesAtual = primeiroDiaDoMes();
    if (ultimoMesFechado === mesAtual) return;
    try {
      const resumo = await fecharComissoesDoMes(mesAtual);
      ultimoMesFechado = mesAtual;
      if (resumo.criadas > 0) {
        console.log(`[comissoes] Mês ${resumo.mes_referencia}: ${resumo.criadas} comissão(ões) criada(s), total R$ ${resumo.valor_total}.`);
      }
    } catch (err) {
      // Não marca o mês como fechado: tenta de novo na próxima hora.
      console.error('Erro no fechamento mensal de comissões:', err);
    }
  };
  rodarFechamentoMensal();
  setInterval(rodarFechamentoMensal, UMA_HORA);
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
