const nodemailer = require('nodemailer');

const transportador = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Envia um e-mail simples em HTML.
 * @param {string} para - e-mail do destinatário
 * @param {string} assunto - assunto do e-mail
 * @param {string} html - corpo em HTML
 */
const enviarEmail = async (para, assunto, html) => {
  await transportador.sendMail({
    from: `"Vínculo" <${process.env.EMAIL_USER}>`,
    to: para,
    subject: assunto,
    html
  });
};

module.exports = { enviarEmail };