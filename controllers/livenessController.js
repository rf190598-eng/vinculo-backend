// livenessController.js
// Lógica de backend para o Face Liveness do Vínculo.
//
// Fluxo completo (atualizado):
// 1. Liveness confirma que existe uma pessoa de verdade, viva, na câmera (Rekognition Face
//    Liveness). Isso roda logo após o cadastro, ANTES de existir qualquer foto de perfil.
//    Se aprovado, a imagem de referência do liveness é salva e guardada em
//    foto_referencia_liveness — ela é a "referência confiável" do rosto do usuário.
// 2. O usuário completa o resto do cadastro (bio, prompts, etc) e, em algum momento,
//    envia sua primeira foto de perfil (perfilController.uploadFoto). É SÓ NESSE MOMENTO
//    que a foto é comparada (Rekognition CompareFaces, via compararRostos) com a
//    referência do liveness, silenciosamente. Se bater, aí sim o usuário vira verificado.
// 3. Fotos extras da galeria (depois da primeira) não passam por nenhuma comparação.
//
// ===== Correção de segurança (auditoria — achados CRÍTICO 1 e CRÍTICO 2) =====
// CRÍTICO 1: a imagem de referência do liveness (selfie de verificação de identidade)
// NÃO fica mais em /uploads (pasta pública, servida por express.static). Fica em
// uploads/privado/liveness/ — dentro do mesmo Volume persistente do Railway (pra
// sobreviver a deploys), mas num subcaminho que index.js bloqueia explicitamente
// antes do express.static (ver bloqueio em index.js). Só é entregue através de
// obterFotoLivenessPropria/obterFotoLivenessAdmin, com checagem de posse.
// Registros antigos (de antes desta correção) guardam '/uploads/arquivo.jpg' —
// caminhoArquivoLiveness() sabe ler os dois formatos; migrarFotosLivenessAntigas()
// move os antigos pra pasta privada e atualiza o valor salvo.
//
// CRÍTICO 2: o sessionId do liveness agora é vinculado ao usuário que o criou
// (campo liveness_session_pendente em Usuario) e checado antes de qualquer consulta
// de resultado — antes, qualquer usuário autenticado podia consultar o resultado de
// QUALQUER sessionId, inclusive de outra pessoa.

const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} = require('@aws-sdk/client-rekognition');
const Usuario = require('../models/Usuario');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGIAO_LIVENESS = process.env.AWS_REKOGNITION_LIVENESS_REGION || 'us-east-1';

// Timeouts explícitos: sem eles, o SDK espera INDEFINIDAMENTE por uma resposta
// da AWS. Se a Rekognition ficar lenta ou a conexão de saída pendurar, a rota
// nunca responde, o fetch do app fica aberto para sempre e o usuário trava na
// tela "preparando a câmera" sem erro nenhum — que é exatamente o sintoma
// relatado. Com timeout, a chamada falha rápido e vira erro tratável.
const rekognitionClient = new RekognitionClient({
  region: REGIAO_LIVENESS,
  maxAttempts: 3,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15000
  }
});
const CONFIANCA_MINIMA = Number(process.env.LIVENESS_CONFIANCA_MINIMA || 90);

// Subpasta DENTRO de uploads/ (mesmo Volume persistente do Railway) — mas
// bloqueada de acesso público por um guard em index.js, montado ANTES do
// express.static('/uploads', ...). Não pode ficar fora de uploads/ porque só
// o que está dentro dessa pasta sobrevive a um novo deploy.
const PASTA_LIVENESS_PRIVADA = path.join(__dirname, '..', 'uploads', 'privado', 'liveness');

function garantirPastaLivenessPrivada() {
  if (!fs.existsSync(PASTA_LIVENESS_PRIVADA)) fs.mkdirSync(PASTA_LIVENESS_PRIVADA, { recursive: true });
}

// Resolve o caminho físico de uma referência de liveness a partir do valor
// salvo em foto_referencia_liveness. Aceita os dois formatos:
// - novo: só o nome do arquivo (ex: "abc123.jpg") -> pasta privada
// - antigo (registros de antes desta correção): "/uploads/abc123.jpg" -> pasta
//   pública antiga, mantido como fallback de leitura até rodar a migração
//   (ver migrarFotosLivenessAntigas).
function caminhoArquivoLiveness(valorSalvo) {
  if (!valorSalvo) return null;
  if (valorSalvo.startsWith('/uploads/')) {
    return path.join(__dirname, '..', valorSalvo.replace(/^\//, ''));
  }
  return path.join(PASTA_LIVENESS_PRIVADA, valorSalvo);
}

async function criarSessaoLiveness(req, res) {
  const inicio = Date.now();
  try {
    const comando = new CreateFaceLivenessSessionCommand({});
    const resultado = await rekognitionClient.send(comando);

    // CRÍTICO 2: vincula esta sessão ao usuário que a pediu. buscarResultadoLiveness
    // só aceita consultar o resultado se o sessionId bater com o que está aqui.
    await Usuario.update(
      { liveness_session_pendente: resultado.SessionId },
      { where: { id: req.usuarioId } }
    );

    console.log(`[liveness] sessão criada em ${Date.now() - inicio}ms para usuário ${req.usuarioId}`);
    return res.json({ sessionId: resultado.SessionId });
  } catch (erro) {
    // Log detalhado: sem um sistema de log persistente no projeto, o stdout do
    // Railway é a única trilha para diagnosticar travamentos como este.
    console.error('[liveness] FALHA ao criar sessão', {
      usuario: req.usuarioId,
      ms: Date.now() - inicio,
      nome: erro.name,
      mensagem: erro.message,
      regiao: REGIAO_LIVENESS
    });
    return res.status(500).json({ erro: 'Não foi possível iniciar a verificação de liveness.' });
  }
}

// Credita o bônus de indicação pra quem indicou o usuário recém-verificado.
// Reutilizada pelo perfilController.uploadFoto, que agora é o lugar do backend
// que efetivamente confirma identidade (comparando a 1ª foto de perfil com a
// referência do liveness).
async function creditarBonusIndicacaoSeAplicavel(usuarioVerificado) {
  if (!usuarioVerificado.indicado_por || usuarioVerificado.bonus_indicacao_creditado) return;

  const referenciador = await Usuario.findOne({ where: { codigo_indicacao: usuarioVerificado.indicado_por } });
  if (!referenciador) return;

  // Só estende quem já está num plano com data de expiração de verdade (fase paga).
  // Se o indicador já tem premium sem data de expiração (fase gratuita atual),
  // não faz sentido "trocar" isso por um prazo de 7 dias - isso rebaixaria
  // quem deveria estar sendo recompensado.
  if (referenciador.premium_ate) {
    const agora = new Date();
    const baseAtual = new Date(referenciador.premium_ate) > agora ? new Date(referenciador.premium_ate) : agora;
    const novoPremiumAte = new Date(baseAtual.getTime() + 7 * 24 * 60 * 60 * 1000);
    await Usuario.update(
      { premium: true, premium_ate: novoPremiumAte },
      { where: { id: referenciador.id } }
    );
  }

  await Usuario.update(
    { bonus_indicacao_creditado: true },
    { where: { id: usuarioVerificado.id } }
  );
}

async function buscarResultadoLiveness(req, res) {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ erro: 'sessionId é obrigatório.' });
  }

  try {
    // CRÍTICO 2: a sessão consultada precisa ser a mesma que ESTE usuário criou.
    // Sem isso, bastava saber (ou reaproveitar) o sessionId de outra pessoa pra
    // herdar o resultado dela, inclusive uma aprovação.
    const usuarioAtual = await Usuario.findByPk(req.usuarioId);
    if (!usuarioAtual || usuarioAtual.liveness_session_pendente !== sessionId) {
      return res.status(403).json({ erro: 'Sessão de verificação inválida ou de outro usuário.' });
    }

    const comando = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const resultado = await rekognitionClient.send(comando);

    const confianca = resultado.Confidence || 0;
    const livenessPassou = resultado.Status === 'SUCCEEDED' && confianca >= CONFIANCA_MINIMA;

    // Sessão consultada = encerrada. Impede reconsultar o mesmo sessionId de novo.
    await Usuario.update({ liveness_session_pendente: null }, { where: { id: req.usuarioId } });

    if (!livenessPassou || !resultado.ReferenceImage || !resultado.ReferenceImage.Bytes) {
      return res.json({ aprovado: false, confianca, status: resultado.Status });
    }

    // Salva a imagem de referência do liveness — ela ainda não é comparada com nada
    // aqui (não existe foto de perfil nesse ponto do fluxo). Fica guardada pra ser
    // usada como referência quando o usuário definir a primeira foto de perfil
    // (ver perfilController.uploadFoto). Vai pra pasta PRIVADA (ver comentário no
    // topo do arquivo) — nunca pra uploads/ direto, que é pública.
    garantirPastaLivenessPrivada();
    const nomeArquivo = `${crypto.randomUUID()}.jpg`;
    const caminhoReferencia = path.join(PASTA_LIVENESS_PRIVADA, nomeArquivo);
    fs.writeFileSync(caminhoReferencia, Buffer.from(resultado.ReferenceImage.Bytes));

    // Liveness aprovado é suficiente pra essa etapa. "verificado" só vira true
    // mais adiante, quando a primeira foto de perfil bater com essa referência.
    await Usuario.update(
      {
        liveness_aprovado: true,
        liveness_confianca: confianca,
        foto_referencia_liveness: nomeArquivo, // só o nome do arquivo — não é mais uma URL pública
      },
      { where: { id: req.usuarioId } }
    );

    return res.json({ aprovado: true, confianca, status: resultado.Status });
  } catch (erro) {
    console.error('Erro ao buscar resultado de liveness:', erro);
    return res.status(500).json({ erro: 'Não foi possível verificar o resultado do liveness.' });
  }
}

// Entrega a PRÓPRIA referência de liveness — só o dono, autenticado. Hoje nada no
// app mostra essa foto (é só a referência interna da comparação), mas a rota existe
// pra qualquer uso legítimo futuro nascer já seguro por padrão.
async function obterFotoLivenessPropria(req, res) {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: ['foto_referencia_liveness'] });
    const caminho = caminhoArquivoLiveness(usuario && usuario.foto_referencia_liveness);
    if (!caminho || !fs.existsSync(caminho)) {
      return res.status(404).json({ erro: 'Nenhuma foto de verificação encontrada.' });
    }
    return res.sendFile(caminho);
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro ao buscar foto de verificação: ' + erro.message });
  }
}

// Entrega a referência de liveness de QUALQUER usuário — só admin (moderação).
async function obterFotoLivenessAdmin(req, res) {
  try {
    const usuario = await Usuario.findByPk(req.params.usuarioId, { attributes: ['foto_referencia_liveness'] });
    const caminho = caminhoArquivoLiveness(usuario && usuario.foto_referencia_liveness);
    if (!caminho || !fs.existsSync(caminho)) {
      return res.status(404).json({ erro: 'Nenhuma foto de verificação encontrada.' });
    }
    return res.sendFile(caminho);
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro ao buscar foto de verificação: ' + erro.message });
  }
}

// Migração única dos registros antigos: move o arquivo físico de uploads/ pra
// uploads/privado/liveness/ e atualiza foto_referencia_liveness pra guardar só o
// nome do arquivo. Idempotente (só mexe em quem ainda está no formato antigo
// '/uploads/...'), então pode ser chamada mais de uma vez sem problema. Rota
// protegida por admin — ver instruções de uso separadas.
async function migrarFotosLivenessAntigas(req, res) {
  try {
    garantirPastaLivenessPrivada();

    const usuarios = await Usuario.findAll({
      where: { foto_referencia_liveness: { [Op.like]: '/uploads/%' } },
      attributes: ['id', 'foto_referencia_liveness']
    });

    let migrados = 0;
    const falhas = [];

    for (const usuario of usuarios) {
      const valorAntigo = usuario.foto_referencia_liveness;
      const nomeArquivo = path.basename(valorAntigo);
      const origem = path.join(__dirname, '..', valorAntigo.replace(/^\//, ''));
      const destino = path.join(PASTA_LIVENESS_PRIVADA, nomeArquivo);

      try {
        if (fs.existsSync(origem)) {
          fs.renameSync(origem, destino);
        } else {
          console.warn('[liveness-migracao] arquivo antigo não encontrado no disco, só atualizando o registro:', origem);
        }
        await Usuario.update(
          { foto_referencia_liveness: nomeArquivo },
          { where: { id: usuario.id } }
        );
        migrados++;
      } catch (erroItem) {
        falhas.push({ usuario_id: usuario.id, erro: erroItem.message });
      }
    }

    return res.json({
      mensagem: 'Migração concluída.',
      total_encontrados: usuarios.length,
      migrados,
      falhas
    });
  } catch (erro) {
    return res.status(500).json({ erro: 'Erro na migração: ' + erro.message });
  }
}

module.exports = {
  criarSessaoLiveness,
  buscarResultadoLiveness,
  creditarBonusIndicacaoSeAplicavel,
  caminhoArquivoLiveness,
  obterFotoLivenessPropria,
  obterFotoLivenessAdmin,
  migrarFotosLivenessAntigas,
};
