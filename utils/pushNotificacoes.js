/**
 * Envio de Web Push (VAPID) — será usado pelos gatilhos reais (match,
 * curtida, mensagem) nos Lotes 1/2. O "sininho" interno (model Notificacao)
 * continua sempre ativo independente disso (achado 3 da auditoria
 * fake-vs-real: o toggle de notificação deve controlar a INTERRUPÇÃO de
 * verdade — o push — não o registro interno).
 *
 * Chaves VAPID configuradas via variáveis de ambiente (VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT) — nunca hardcoded aqui. Sem elas,
 * enviarPush() não falha o fluxo principal — só loga e não manda nada
 * (fail-open: uma falha de push nunca deve impedir o match/curtida/mensagem
 * de serem registrados de verdade).
 */
const webpush = require('web-push');
const InscricaoPush = require('../models/InscricaoPush');

const vapidConfigurado = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
// vapidValido (não só vapidConfigurado): setVapidDetails() valida o formato
// da chave e lança síncrono se ela não for Base64 URL-safe válida. Sem o
// try/catch, uma chave malformada travava o processo inteiro no boot —
// achado no ar em 2026-09 (a rota nunca tinha sido carregada até o Lote 1
// de gatilhos exercitar este require pela primeira vez). Config inválida
// deve desativar só o push, nunca o servidor inteiro.
let vapidValido = false;
if (vapidConfigurado) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contato@vinculoapp.com.br',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    vapidValido = true;
  } catch (erro) {
    console.error('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY inválidas — notificações push desativadas:', erro.message);
  }
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — notificações push desativadas.');
}

// Envia uma notificação push pra todos os dispositivos inscritos de um
// usuário. Nunca lança: uma falha de push é sempre não-crítica pro fluxo que
// a chamou, então qualquer erro só é logado.
async function enviarPush(usuario_id, payload) {
  if (!vapidValido) return;
  try {
    const inscricoes = await InscricaoPush.findAll({ where: { usuario_id } });
    if (inscricoes.length === 0) return;

    const corpo = JSON.stringify(payload);
    await Promise.all(inscricoes.map(async (inscricao) => {
      const assinatura = {
        endpoint: inscricao.endpoint,
        keys: { p256dh: inscricao.p256dh, auth: inscricao.auth }
      };
      try {
        await webpush.sendNotification(assinatura, corpo);
      } catch (erro) {
        // 404/410 = inscrição morta (usuário desinstalou, navegador expirou
        // o endpoint) — limpa pra não acumular lixo nem tentar de novo à toa.
        if (erro.statusCode === 404 || erro.statusCode === 410) {
          await inscricao.destroy();
        } else {
          console.error('[push] Falha ao enviar para', inscricao.endpoint, ':', erro.message);
        }
      }
    }));
  } catch (erro) {
    console.error('[push] Erro geral ao enviar notificação:', erro.message);
  }
}

module.exports = { enviarPush };
