
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
const crypto = require('crypto');
require('dotenv').config();
const { conectarBanco, sequelize } = require('./database');
const { Op } = require('sequelize');
const TokenRevogado = require('./models/TokenRevogado');
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
  rotasAdminComissoes,
  rotasAdminMetas
} = require('./routes/parceiros');
const {
  fecharComissoesDoMes,
  primeiroDiaDoMes,
  verificarMetasAtingidas
} = require('./controllers/parceiroController');
const { verificarCheckinsVencidos } = require('./controllers/segurancaController');
const {
  verificarAssinaturasVencidas,
  verificarLembretesRenovacao
} = require('./controllers/pagamentoController');
const { enviarLembretePagamentoComissoes } = require('./controllers/adminParceiroController');

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
// verify: guarda os bytes brutos do corpo em req.rawBody — necessário pra
// validar a assinatura HMAC do webhook do WhatsApp (X-Hub-Signature-256 é
// calculada sobre o corpo EXATO como chegou, não sobre o JSON reserializado).
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
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

// ===== Bloqueio de /uploads/privado (correção do achado CRÍTICO 1 da auditoria) =====
// uploads/privado/liveness/ guarda as selfies de referência do Face Liveness
// (livenessController.js). Precisa estar DENTRO de uploads/ pra sobreviver a
// deploys (é onde o Volume persistente do Railway está montado), mas NUNCA pode
// ser servida como arquivo estático público como o resto de uploads/ — por isso
// este bloqueio vem ANTES do express.static logo abaixo e intercepta qualquer
// pedido a esse subcaminho com 404, não importa se o arquivo existe ou não.
// O único jeito de acessar essas fotos é pelas rotas autenticadas em
// routes/livenessRoutes.js (obterFotoLivenessPropria / obterFotoLivenessAdmin).
app.use('/uploads/privado', (req, res) => {
  res.status(404).end();
});

// ===== ATENÇÃO: /uploads público =====
// Fotos de perfil e mídia de stories ficam aqui (são públicas por natureza do
// produto). Nada de sensível (verificação de identidade, documentos) pode ser
// salvo direto nesta pasta — tem que ir para uploads/privado/, bloqueada acima.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'online', app: 'Vinculo Backend', versao: '1.0.0', mensagem: 'Servidor funcionando!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== Webhook do WhatsApp Business Cloud API (Meta) =====
// Sem middleware de JWT: quem chama aqui é a Meta, não um usuário logado.
//
// GET: usada só uma vez (ou quando você reconfigura a URL no App do Meta),
// pra provar que este servidor é o dono do endpoint. A Meta manda um desafio
// (hub.challenge) e espera recebê-lo de volta como texto puro, só se o token
// que ela enviar bater com o nosso.
app.get('/webhook/whatsapp', (req, res) => {
  const modo = req.query['hub.mode'];
  const tokenRecebido = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && tokenRecebido === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
});

// POST: aqui chegam os eventos de verdade (mensagem recebida, status de
// entrega sent/delivered/read/failed, etc). A Meta exige resposta rápida
// (200) e reenvia com retry/backoff se não responder a tempo — por isso só
// logamos e respondemos, sem processamento pesado nesta rota. Quando formos
// realmente tratar os eventos (responder mensagem, atualizar status no banco
// etc), o ideal é enfileirar aqui e processar fora do ciclo de request.
//
// Correção do achado IMPORTANTE da auditoria: valida o header
// X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret do Meta —
// NÃO é o WHATSAPP_WEBHOOK_VERIFY_TOKEN usado no GET acima, que é outro
// segredo, só para a checagem inicial da URL). Fail-closed: sem
// WHATSAPP_APP_SECRET configurado, ou com assinatura que não bate, o evento
// é rejeitado.
function validarAssinaturaWhatsapp(rawBody, assinaturaRecebida) {
  if (!assinaturaRecebida || !rawBody) return false;
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) {
    console.error('[whatsapp-webhook] WHATSAPP_APP_SECRET não configurado — rejeitando por segurança.');
    return false;
  }
  const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(rawBody).digest('hex');
  const bufEsperada = Buffer.from(esperada);
  const bufRecebida = Buffer.from(String(assinaturaRecebida));
  if (bufEsperada.length !== bufRecebida.length) return false;
  return crypto.timingSafeEqual(bufEsperada, bufRecebida);
}

app.post('/webhook/whatsapp', (req, res) => {
  if (!validarAssinaturaWhatsapp(req.rawBody, req.headers['x-hub-signature-256'])) {
    console.error('[whatsapp-webhook] assinatura inválida — evento rejeitado.');
    return res.sendStatus(403);
  }
  console.log('[whatsapp-webhook] evento recebido:', JSON.stringify(req.body));
  res.sendStatus(200);
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
app.use('/api/admin/metas', rotasAdminMetas);

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

  // Metas de bônus: verificadas de hora em hora, sem trava mensal. Uma meta de
  // 30 dias precisa ser detectada perto de quando é batida — esperar a virada
  // do mês poderia deixá-la expirar sem crédito.
  const rodarVerificacaoMetas = () => {
    verificarMetasAtingidas().catch((err) => {
      console.error('Erro ao verificar metas de bônus:', err);
    });
  };
  rodarVerificacaoMetas();
  setInterval(rodarVerificacaoMetas, UMA_HORA);

  // Lembrete de renovação por WhatsApp. Uma vez por dia basta: a janela de
  // busca é de 48h, então mesmo que uma execução falhe (ou o processo reinicie
  // e perca o intervalo), a próxima ainda pega a mesma pessoa a tempo.
  const UM_DIA = 24 * UMA_HORA;
  const rodarLembretesRenovacao = () => {
    verificarLembretesRenovacao().catch((err) => {
      console.error('Erro ao enviar lembretes de renovação:', err);
    });
  };
  rodarLembretesRenovacao();
  setInterval(rodarLembretesRenovacao, UM_DIA);

  // Lembrete (só para o admin) de pagar as comissões dos parceiros.
  //
  // Mesma estratégia do fechamento mensal: em vez de agendar "dia 3 à
  // meia-noite" — que o processo pode perder se estiver reiniciando naquele
  // instante, e aí o mês inteiro passa sem aviso — roda de hora em hora e
  // pergunta se estamos na janela. Dispara no primeiro tique dentro dela.
  //
  // A janela de dois dias (3 e 4) é a folga: se o serviço ficar fora do ar o
  // dia 3 todo, o dia 4 ainda salva o lembrete antes do prazo do dia 5.
  //
  // A trava ultimoMesLembretePagamento é em memória. Um restart dentro da
  // janela pode gerar um segundo e-mail — preço aceitável: para um lembrete,
  // duplicar é inofensivo; não avisar, não.
  //
  // A trava só é marcada quando o envio dá CERTO (mesma regra do lembrete de
  // renovação por WhatsApp). Se o Resend estiver fora do ar, o job continua
  // tentando de hora em hora até o fim do dia 4, em vez de dar o mês por
  // resolvido só porque tentou uma vez.
  const DIAS_LEMBRETE_PAGAMENTO = [3, 4];
  let ultimoMesLembretePagamento = null;
  const rodarLembretePagamento = async () => {
    const agora = new Date();
    if (!DIAS_LEMBRETE_PAGAMENTO.includes(agora.getDate())) return;
    const mesAtual = `${agora.getFullYear()}-${agora.getMonth() + 1}`;
    if (ultimoMesLembretePagamento === mesAtual) return;
    try {
      const resultado = await enviarLembretePagamentoComissoes();
      if (resultado && resultado.enviado) ultimoMesLembretePagamento = mesAtual;
    } catch (err) {
      console.error('Erro no lembrete de pagamento de comissões:', err);
    }
  };
  rodarLembretePagamento();
  setInterval(rodarLembretePagamento, UMA_HORA);

  // Limpeza da blacklist de tokens revogados (logout — ver TokenRevogado.js).
  // Uma vez por dia basta: uma linha só vira "lixo" depois que seu próprio
  // exp já teria expirado o JWT de qualquer forma, então não há urgência.
  const limparTokensRevogados = () => {
    TokenRevogado.destroy({ where: { expira_em: { [Op.lt]: new Date() } } })
      .catch((err) => console.error('Erro ao limpar tokens revogados:', err));
  };
  limparTokensRevogados();
  setInterval(limparTokensRevogados, UM_DIA);
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
