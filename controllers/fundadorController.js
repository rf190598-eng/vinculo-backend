const Fundador = require('../models/Fundador');

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENEROS_VALIDOS = ['masculino', 'feminino', 'nao-binario'];

// Mesmo padrão de gerarCodigoIndicacao do authController: nome limpo (sem
// acento, só letras) + 4 dígitos aleatórios.
function gerarCodigoProprio(nome) {
  const base = (nome || 'fundador').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '').slice(0, 10) || 'fundador';
  const numero = Math.floor(1000 + Math.random() * 9000);
  return base + numero;
}

function montarLinks(fundador) {
  const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  return {
    link_indicacao: `${baseUrl}/fundadores/${fundador.codigo_proprio}`,
    link_comunidade_whatsapp: process.env.WHATSAPP_COMUNIDADE_LINK || null
  };
}

const cadastrar = async (req, res) => {
  try {
    const { nome, email, telefone, genero } = req.body;
    const refCodigo = req.body.ref || req.query.ref || null;

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ erro: 'Nome é obrigatório' });
    }
    const nomeLimpo = String(nome).replace(/<[^>]*>/g, '').trim().slice(0, 100);

    if (!email || !REGEX_EMAIL.test(String(email).trim())) {
      return res.status(400).json({ erro: 'E-mail inválido' });
    }
    const emailNormalizado = String(email).trim().toLowerCase();

    if (!telefone || !String(telefone).trim()) {
      return res.status(400).json({ erro: 'Telefone é obrigatório' });
    }
    const telefoneLimpo = String(telefone).trim().slice(0, 30);

    if (!genero || !GENEROS_VALIDOS.includes(genero)) {
      return res.status(400).json({ erro: 'Gênero inválido' });
    }

    const jaExiste = await Fundador.findOne({ where: { email: emailNormalizado } });
    if (jaExiste) {
      return res.status(400).json({ erro: 'Esse e-mail já está cadastrado nos Fundadores.' });
    }

    let codigo_proprio = gerarCodigoProprio(nomeLimpo);
    let tentativas = 0;
    while (await Fundador.findOne({ where: { codigo_proprio } }) && tentativas < 5) {
      codigo_proprio = gerarCodigoProprio(nomeLimpo);
      tentativas++;
    }

    // Proteção contra auto-indicação: se o código informado resolve pra um
    // cadastro com o MESMO e-mail que está se cadastrando agora, ignora o
    // código (na prática quase impossível de acontecer, já que o e-mail é
    // único — mas é barato de checar e fecha a brecha por completo).
    let codigo_indicador = null;
    if (refCodigo) {
      const referenciador = await Fundador.findOne({ where: { codigo_proprio: refCodigo } });
      if (referenciador && referenciador.email !== emailNormalizado) {
        codigo_indicador = referenciador.codigo_proprio;
      }
    }

    const fundador = await Fundador.create({
      nome: nomeLimpo, email: emailNormalizado, telefone: telefoneLimpo, genero, codigo_proprio, codigo_indicador
    });

    res.status(201).json({
      nome: fundador.nome,
      codigo_proprio: fundador.codigo_proprio,
      total_indicados: 0,
      ...montarLinks(fundador)
    });
  } catch (erro) {
    if (erro.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ erro: 'Esse e-mail já está cadastrado nos Fundadores.' });
    }
    console.error('Erro ao cadastrar fundador:', erro);
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
};

// Rota pública e sem dado sensível — usada pela própria página de
// confirmação pra recarregar "você já convidou N pessoas" se a pessoa sair
// e voltar (o código fica salvo no navegador dela via localStorage).
const buscarResumoPorCodigo = async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '');
    const fundador = await Fundador.findOne({ where: { codigo_proprio: codigo } });
    if (!fundador) return res.status(404).json({ erro: 'Código não encontrado' });

    const total_indicados = await Fundador.count({ where: { codigo_indicador: fundador.codigo_proprio } });

    res.json({
      nome: fundador.nome,
      codigo_proprio: fundador.codigo_proprio,
      total_indicados,
      ...montarLinks(fundador)
    });
  } catch (erro) {
    console.error('Erro ao buscar resumo de fundador:', erro);
    res.status(500).json({ erro: 'Erro ao buscar dados' });
  }
};

// Painel admin: total, separado por gênero, e ranking de quem mais indicou.
const painelAdmin = async (req, res) => {
  try {
    const total = await Fundador.count();

    const porGeneroRaw = await Fundador.findAll({
      attributes: ['genero', [Fundador.sequelize.fn('COUNT', '*'), 'total']],
      group: ['genero']
    });
    const por_genero = { masculino: 0, feminino: 0, 'nao-binario': 0 };
    porGeneroRaw.forEach(linha => { por_genero[linha.genero] = Number(linha.get('total')); });

    const todos = await Fundador.findAll({
      attributes: ['nome', 'email', 'telefone', 'genero', 'codigo_proprio', 'codigo_indicador', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });

    // Conta indicações em memória (tabela pequena, sem necessidade de
    // subquery correlacionada) e monta o ranking dos que mais indicaram.
    const contagemPorCodigo = {};
    todos.forEach(f => {
      if (f.codigo_indicador) contagemPorCodigo[f.codigo_indicador] = (contagemPorCodigo[f.codigo_indicador] || 0) + 1;
    });
    const top_indicadores = todos
      .filter(f => contagemPorCodigo[f.codigo_proprio])
      .map(f => ({ nome: f.nome, codigo_proprio: f.codigo_proprio, total_indicados: contagemPorCodigo[f.codigo_proprio] }))
      .sort((a, b) => b.total_indicados - a.total_indicados)
      .slice(0, 20);

    res.json({
      total,
      por_genero,
      top_indicadores,
      lista: todos.map(f => ({
        nome: f.nome, email: f.email, telefone: f.telefone, genero: f.genero,
        codigo_proprio: f.codigo_proprio, codigo_indicador: f.codigo_indicador,
        total_indicados: contagemPorCodigo[f.codigo_proprio] || 0,
        data_cadastro: f.createdAt
      }))
    });
  } catch (erro) {
    console.error('Erro ao montar painel de fundadores:', erro);
    res.status(500).json({ erro: 'Erro ao montar painel' });
  }
};

module.exports = { cadastrar, buscarResumoPorCodigo, painelAdmin };
