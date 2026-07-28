const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envia um e-mail simples em HTML.
 * @param {string} para - e-mail do destinatário
 * @param {string} assunto - assunto do e-mail
 * @param {string} html - corpo em HTML
 */
const enviarEmail = async (para, assunto, html) => {
  const { data, error } = await resend.emails.send({
    from: 'Vínculo <contato@vinculoapp.com.br>',
    to: para,
    subject: assunto,
    html
  });

  if (error) {
    console.error('Erro ao enviar e-mail via Resend:', error);
    throw new Error('Falha ao enviar e-mail: ' + JSON.stringify(error));
  }

  return data;
};

module.exports = { enviarEmail };
