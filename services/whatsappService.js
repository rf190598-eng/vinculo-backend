// Integração com a WhatsApp Business Cloud API (Meta).
// Documentação: https://developers.facebook.com/docs/whatsapp/cloud-api

const WHATSAPP_API_VERSION = 'v23.0';

// Normaliza um telefone em formato livre para o padrão que a Cloud API
// espera: DDI + DDD + número, só dígitos, sem "+", sem espaços/traços.
// Assume Brasil (55) quando não há indicação de outro país.
//
// Casos tratados:
//  - "(11) 98888-7777"      -> "5511988887777"
//  - "011988887777"          -> "5511988887777"   (zero de discagem removido)
//  - "5511988887777"         -> "5511988887777"   (já normalizado, mantém)
//  - "1188887777" (celular sem o 9º dígito, DDD+8 dígitos)
//                             -> "5511988887777"   (insere o "9")
//
// Importante: a heurística do "insere o 9" assume celular quando o número,
// após o DDI, tem exatamente 10 dígitos (DDD + 8). Fixos de 10 dígitos após
// o DDI são raros de aparecer aqui (campo é de contato pessoal), mas se
// acontecer o número sai com um "9" indevido — não há como distinguir
// programaticamente sem mais contexto. Vale revisar na prática.
function normalizarTelefoneE164(telefoneBruto) {
  let digitos = String(telefoneBruto || '').replace(/\D/g, '');
  digitos = digitos.replace(/^0+/, ''); // remove zero(s) de discagem local

  if (!digitos.startsWith('55')) {
    digitos = '55' + digitos;
  }

  const restante = digitos.slice(2); // tudo depois do DDI
  if (restante.length === 10) {
    // DDD (2) + número de 8 dígitos. Só insere o 9º dígito se o primeiro
    // dígito do número local indicar celular no formato antigo (6-9) — no
    // plano de numeração da Anatel, fixo sempre começa com 2-5. Sem essa
    // checagem, um fixo de 8 dígitos (ex: 3222-1234) virava um "celular"
    // inventado (93222-1234) que nunca vai receber WhatsApp de verdade.
    const primeiroDigitoLocal = restante[2];
    if (['6', '7', '8', '9'].includes(primeiroDigitoLocal)) {
      digitos = '55' + restante.slice(0, 2) + '9' + restante.slice(2);
    }
    // Começa com 2-5: é fixo. Não insere o 9 — fica com 12 dígitos totais,
    // o que a validação de 13 dígitos em criarContato() já rejeita.
  }

  return digitos; // 13 dígitos no caso comum: 55 + DDD(2) + 9 + número(8)
}

// DDDs realmente existentes no Brasil (plano de numeração da Anatel).
// Números com DDD fora dessa lista são rejeitados mesmo tendo a quantidade
// certa de dígitos.
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

// Valida um telefone JÁ NORMALIZADO (saída de normalizarTelefoneE164) como
// celular brasileiro capaz de receber WhatsApp.
//
// Mora aqui, e não no controller que a usa, porque a mesma regra vale para o
// contato de confiança (segurancaController) e para o telefone do próprio
// usuário (pagamentoController). Duplicar a lista de DDDs em dois arquivos
// significaria, no dia em que a Anatel criar um DDD novo, atualizar só um.
//
// Regra: 55 (DDI) + DDD (2) + "9" obrigatório + 8 dígitos. O "9" fixo é o que
// distingue celular de fixo — sem ele, um número de 13 dígitos começando com
// 1-5 depois do DDD passava como válido sem existir de verdade.
function validarTelefoneCelularBR(telefoneNormalizado) {
  if (!/^55\d{2}9\d{8}$/.test(String(telefoneNormalizado || ''))) return false;
  return DDDS_VALIDOS.has(Number(String(telefoneNormalizado).slice(2, 4)));
}

// Envia uma mensagem de template pelo WhatsApp Business Cloud API.
// Nunca lança exceção — sempre resolve com { sucesso, ... }, para que quem
// chama (ex: botão de pânico) não trave o fluxo principal por causa de uma
// falha de integração externa.
async function enviarMensagemTemplate(telefone, nomeTemplate, parametros) {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !token) {
      return { sucesso: false, erro: 'WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN não configurados' };
    }

    const telefoneNormalizado = normalizarTelefoneE164(telefone);

    const resposta = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: telefoneNormalizado,
          type: 'template',
          template: {
            name: nomeTemplate,
            language: { code: 'pt_BR' },
            components: [{
              type: 'body',
              parameters: (parametros || []).map(p => ({ type: 'text', text: String(p) }))
            }]
          }
        })
      }
    );

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      const erroMsg = (dados && dados.error && dados.error.message) || `HTTP ${resposta.status}`;
      return { sucesso: false, erro: erroMsg };
    }

    const wamid = dados && dados.messages && dados.messages[0] && dados.messages[0].id;
    return { sucesso: true, wamid };
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  }
}

module.exports = {
  enviarMensagemTemplate,
  normalizarTelefoneE164,
  validarTelefoneCelularBR,
  DDDS_VALIDOS
};
