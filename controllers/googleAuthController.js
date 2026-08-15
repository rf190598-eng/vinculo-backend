/**
 * Login/cadastro com Google (OAuth 2.0 Authorization Code).
 *
 * Escolhi a google-auth-library (biblioteca OFICIAL do Google) em vez de
 * passport: o projeto é stateless com JWT e não usa express-session, que o
 * passport praticamente exige para o fluxo OAuth. Aqui são ~3 chamadas de
 * biblioteca e nenhum middleware novo no app.
 *
 * Proteção CSRF sem sessão: o parâmetro `state` é um JWT curto assinado com o
 * mesmo JWT_SECRET. Ele carrega um nonce aleatório e expira em 10 minutos.
 * Na volta, se o state não for um JWT válido e não expirado, o callback é
 * recusado. Não precisa guardar nada no servidor nem em cookie.
 */
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Usuario = require('../models/Usuario');
const { resolverParceiroPorCodigo } = require('./parceiroController');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  || 'https://app.vinculoapp.com.br/api/auth/google/callback';

const JANELA_STATE = '10m';
const JANELA_PRE_CADASTRO = '20m';

function clienteGoogle() {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// Volta sempre para o app com a informação no FRAGMENTO (#) e não na query.
// Fragmento não é enviado ao servidor, não aparece em log de acesso nem no
// header Referer — importante porque aqui trafega token de sessão.
function voltarParaApp(res, fragmento) {
  return res.redirect(302, '/prototipo#' + fragmento);
}

function erroParaApp(res, mensagem) {
  return voltarParaApp(res, 'google_erro=' + encodeURIComponent(mensagem));
}

function gerarCodigoIndicacao(nome) {
  const base = (nome || 'user').toLowerCase().normalize('NFD')
    .replace(/[^a-z]/g, '').slice(0, 10) || 'user';
  return base + Math.floor(1000 + Math.random() * 9000);
}

async function gerarCodigoIndicacaoUnico(nome) {
  let codigo = gerarCodigoIndicacao(nome);
  let tentativas = 0;
  while (await Usuario.findOne({ where: { codigo_indicacao: codigo } }) && tentativas < 5) {
    codigo = gerarCodigoIndicacao(nome);
    tentativas++;
  }
  return codigo;
}

function tokenDeSessao(usuario) {
  return jwt.sign({ id: usuario.id, email: usuario.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

/**
 * GET /api/auth/google?ref=CODIGO
 * Redireciona para a tela de autorização do Google.
 * O `ref` (código de parceiro) viaja dentro do state para não se perder no
 * meio do OAuth — sem isso, cadastro via Google nunca atribuiria indicação.
 */
const iniciarLoginGoogle = (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('[google] GOOGLE_CLIENT_ID/SECRET ausentes no ambiente');
    return erroParaApp(res, 'Login com Google indisponível no momento.');
  }
  try {
    const state = jwt.sign(
      { n: crypto.randomBytes(16).toString('hex'), ref: req.query.ref || null },
      process.env.JWT_SECRET,
      { expiresIn: JANELA_STATE }
    );

    const url = clienteGoogle().generateAuthUrl({
      access_type: 'online',          // não precisamos de refresh token
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account'        // deixa trocar de conta em vez de entrar
                                      // silenciosamente na última usada
    });
    return res.redirect(302, url);
  } catch (erro) {
    console.error('[google] falha ao montar URL de autorização:', erro.message);
    return erroParaApp(res, 'Não foi possível iniciar o login com Google.');
  }
};

/**
 * GET /api/auth/google/callback
 * Três desfechos:
 *   - conta já existe  -> #google_token=<jwt de sessão>
 *   - conta nova       -> #google_pre=<jwt de pré-cadastro> (falta idade/gênero)
 *   - qualquer erro    -> #google_erro=<mensagem>
 */
const callbackGoogle = async (req, res) => {
  // Usuário clicou em "Cancelar" na tela do Google.
  if (req.query.error) {
    return erroParaApp(res, 'Você cancelou a autorização com o Google.');
  }

  const { code, state } = req.query;
  if (!code || !state) {
    return erroParaApp(res, 'Resposta inválida do Google. Tente novamente.');
  }

  // Validação do state (CSRF). Um callback forjado por terceiro não tem como
  // produzir um JWT assinado com o nosso segredo.
  let dadosState;
  try {
    dadosState = jwt.verify(state, process.env.JWT_SECRET);
  } catch (e) {
    console.warn('[google] state inválido ou expirado:', e.message);
    return erroParaApp(res, 'A sessão de login expirou. Tente novamente.');
  }

  try {
    const cliente = clienteGoogle();
    const { tokens } = await cliente.getToken(code);
    if (!tokens.id_token) throw new Error('Google não retornou id_token');

    // Valida assinatura, emissor, expiração e audiência do id_token. É o passo
    // que impede aceitar um token emitido para OUTRO aplicativo.
    const ticket = await cliente.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID
    });
    const perfil = ticket.getPayload();

    const email = String(perfil.email || '').trim().toLowerCase();
    if (!email) return erroParaApp(res, 'Não foi possível obter seu e-mail do Google.');

    // E-mail não verificado no Google não serve como prova de identidade —
    // seria possível criar uma conta Google com e-mail alheio e assumir a
    // conta correspondente no Vínculo.
    if (perfil.email_verified === false) {
      return erroParaApp(res, 'Seu e-mail do Google não está verificado.');
    }

    const usuarioExistente = await Usuario.findOne({ where: { email } });

    if (usuarioExistente) {
      // Conta já existe: entra direto. Marca o vínculo com o Google se ainda
      // não estiver marcado (caso de quem se cadastrou por senha).
      if (!usuarioExistente.google_id) {
        await usuarioExistente.update({ google_id: perfil.sub });
      }
      console.log('[google] login de conta existente:', usuarioExistente.id);
      return voltarParaApp(res, 'google_token=' + encodeURIComponent(tokenDeSessao(usuarioExistente)));
    }

    // Conta nova: NÃO cria ainda. O Google não fornece data de nascimento, e
    // ela é obrigatória (coluna NOT NULL) e é o que sustenta a regra de 18+.
    // Criar com data falsa quebraria a checagem de idade do app.
    const preToken = jwt.sign(
      {
        pre: true,
        google_id: perfil.sub,
        email,
        nome: String(perfil.name || '').slice(0, 100),
        ref: dadosState.ref || null
      },
      process.env.JWT_SECRET,
      { expiresIn: JANELA_PRE_CADASTRO }
    );

    console.log('[google] pré-cadastro iniciado para', email);
    return voltarParaApp(res, 'google_pre=' + encodeURIComponent(preToken));
  } catch (erro) {
    console.error('[google] falha no callback:', erro.message);
    return erroParaApp(res, 'Não foi possível concluir o login com Google. Tente novamente.');
  }
};

/**
 * POST /api/auth/google/finalizar
 * Body: { pre_token, nome, data_nascimento, genero, pref_genero }
 *
 * Segunda etapa do cadastro via Google: coleta o que o Google não fornece e
 * cria a conta de verdade.
 *
 * Fronteira de confiança desta rota:
 *   - E-MAIL e GOOGLE_ID: SOMENTE do pre_token assinado. Nunca lidos do body,
 *     mesmo que o cliente os envie. São eles que definem qual conta é criada
 *     ou vinculada — aceitar do body permitiria criar conta com e-mail alheio.
 *   - NOME: do body. É só rótulo de exibição, não decide identidade nem
 *     vínculo de conta. O nome do Google entra como sugestão inicial, e a
 *     pessoa pode preferir apelido, nome social ou só o primeiro nome.
 */
const finalizarCadastroGoogle = async (req, res) => {
  try {
    const { pre_token, nome, data_nascimento, genero, pref_genero } = req.body || {};

    let dados;
    try {
      dados = jwt.verify(pre_token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ erro: 'Seu cadastro expirou. Entre com o Google novamente.' });
    }
    if (!dados.pre || !dados.email) {
      return res.status(400).json({ erro: 'Token de cadastro inválido.' });
    }

    // Nome editável pela pessoa. Mesma higienização do cadastro por e-mail
    // (remove tags HTML, corta em 100). Se vier vazio, cai no nome do Google.
    const nomeLimpo = String(nome || '').replace(/<[^>]*>/g, '').trim().slice(0, 100);
    const nomeFinal = nomeLimpo || String(dados.nome || '').replace(/<[^>]*>/g, '').trim().slice(0, 100);
    if (!nomeFinal) {
      return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    const GENEROS_VALIDOS = ['masculino', 'feminino', 'nao-binario'];
    const PREF_GENERO_VALIDOS = ['masculino', 'feminino', 'todos'];
    if (genero && !GENEROS_VALIDOS.includes(genero)) {
      return res.status(400).json({ erro: 'Gênero inválido' });
    }
    if (pref_genero && !PREF_GENERO_VALIDOS.includes(pref_genero)) {
      return res.status(400).json({ erro: 'Preferência de gênero inválida' });
    }

    const nascimento = new Date(data_nascimento);
    if (isNaN(nascimento.getTime())) {
      return res.status(400).json({ erro: 'Data de nascimento inválida' });
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const aindaNaoFezAniversario = (hoje.getMonth() < nascimento.getMonth()) ||
      (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate());
    if (aindaNaoFezAniversario) idade--;
    if (idade < 18) {
      return res.status(400).json({ erro: 'É preciso ter 18 anos ou mais para se cadastrar' });
    }

    // Corrida: a pessoa pode ter criado a conta por e-mail/senha entre o
    // callback e este envio.
    const jaExiste = await Usuario.findOne({ where: { email: dados.email } });
    if (jaExiste) {
      if (!jaExiste.google_id) await jaExiste.update({ google_id: dados.google_id });
      return res.json({ mensagem: 'Login realizado!', token: tokenDeSessao(jaExiste), usuario: jaExiste });
    }

    // Conta criada via Google não tem senha escolhida pela pessoa. Gravamos um
    // hash de valor aleatório forte: ninguém consegue logar por senha nessa
    // conta, e quem quiser usar senha depois passa por "Esqueci minha senha".
    const senhaAleatoria = crypto.randomBytes(48).toString('hex');
    const senhaCriptografada = await bcrypt.hash(senhaAleatoria, 10);

    const codigo_indicacao = await gerarCodigoIndicacaoUnico(nomeFinal);

    let indicado_por_parceiro_id = null;
    try {
      indicado_por_parceiro_id = await resolverParceiroPorCodigo(dados.ref);
    } catch (e) {
      console.warn('[google] falha ao resolver parceiro:', e.message);
    }

    const usuario = await Usuario.create({
      nome: nomeFinal,
      // Sempre do token assinado — nunca do body.
      email: dados.email,
      senha: senhaCriptografada,
      data_nascimento,
      genero: genero || null,
      pref_genero: pref_genero || null,
      google_id: dados.google_id,
      codigo_indicacao,
      indicado_por_parceiro_id
    });

    const usuarioCompleto = await Usuario.findByPk(usuario.id, {
      attributes: { exclude: ['senha', 'foto_verificacao', 'foto_referencia_liveness'] }
    });

    console.log('[google] conta criada via Google:', usuario.id);
    // liveness_aprovado e verificado nascem false — o guard de navegação do app
    // manda essa pessoa para o liveness igual a qualquer cadastro por e-mail.
    return res.status(201).json({
      mensagem: 'Cadastro realizado!',
      token: tokenDeSessao(usuario),
      usuario: usuarioCompleto
    });
  } catch (erro) {
    if (erro.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ erro: 'Já existe uma conta com esse e-mail.' });
    }
    console.error('[google] erro ao finalizar cadastro:', erro);
    return res.status(500).json({ erro: 'Não foi possível concluir o cadastro.' });
  }
};

module.exports = { iniciarLoginGoogle, callbackGoogle, finalizarCadastroGoogle };
