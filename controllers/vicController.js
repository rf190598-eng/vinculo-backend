const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT_VIC } = require('../services/vicConhecimento');

// Cliente só é criado se a chave existir — sem ANTHROPIC_API_KEY configurada
// (ex: antes de Roberto cadastrar no Railway), a rota responde 503 em vez de
// quebrar a subida do servidor.
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODELO_VIC = 'claude-haiku-4-5-20251001';
const MAX_CARACTERES_MENSAGEM = 2000; // mesmo limite já usado em chatController
const MAX_MENSAGENS_HISTORICO = 10;   // só as últimas trocas, não a conversa inteira
const MAX_TOKENS_RESPOSTA = 1024;     // teto de custo por resposta, independente da pergunta

const enviarMensagem = async (req, res) => {
  if (!client) {
    return res.status(503).json({ erro: 'A Vic não está configurada neste servidor ainda.' });
  }

  const { mensagem, historico } = req.body;
  if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
    return res.status(400).json({ erro: 'Mensagem é obrigatória.' });
  }
  const mensagemLimpa = mensagem.trim().slice(0, MAX_CARACTERES_MENSAGEM);

  // Histórico vem do navegador (decisão de arquitetura: sessão, não banco)
  // — nunca confiamos no tamanho/formato que o cliente manda, recortamos e
  // validamos aqui de novo independente do que o frontend já filtrou.
  const historicoLimpo = Array.isArray(historico)
    ? historico
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_MENSAGENS_HISTORICO)
        .map(m => ({ role: m.role, content: String(m.content).slice(0, MAX_CARACTERES_MENSAGEM) }))
    : [];

  const mensagens = [...historicoLimpo, { role: 'user', content: mensagemLimpa }];

  // SSE: mantém a conexão aberta e manda cada pedaço da resposta assim que a
  // API da Anthropic entrega, em vez de esperar a resposta inteira pronta.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // evita que um proxy intermediário segure os chunks em buffer
  });
  res.flushHeaders();

  let streamAnthropic;
  try {
    streamAnthropic = client.messages.stream({
      model: MODELO_VIC,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: SYSTEM_PROMPT_VIC,
      messages: mensagens
    });

    streamAnthropic.on('text', (textoNovo) => {
      res.write(`data: ${JSON.stringify({ delta: textoNovo })}\n\n`);
    });

    streamAnthropic.on('error', (erro) => {
      console.error('[vic] Erro durante o streaming:', erro.message);
      res.write(`data: ${JSON.stringify({ erro: 'Erro ao gerar resposta.' })}\n\n`);
      res.end();
    });

    await streamAnthropic.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (erro) {
    console.error('[vic] Erro ao chamar a API da Anthropic:', erro.message);
    // Se o streaming já começou, os headers normais de erro (res.status)
    // não servem mais — manda o erro como evento SSE mesmo.
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ erro: 'Não foi possível falar com a Vic agora.' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ erro: 'Não foi possível falar com a Vic agora.' });
    }
  }

  // Se o cliente fechar a conexão (app em segundo plano, trocou de tela),
  // para de gastar tokens numa resposta que ninguém mais vai ver.
  req.on('close', () => {
    if (streamAnthropic && typeof streamAnthropic.abort === 'function') {
      streamAnthropic.abort();
    }
  });
};

module.exports = { enviarMensagem };
