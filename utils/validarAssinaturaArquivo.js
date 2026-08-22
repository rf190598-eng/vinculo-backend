const fs = require('fs');
const path = require('path');

// Detecta o tipo REAL de um arquivo pelos primeiros bytes (magic number/assinatura),
// em vez de confiar na extensão do nome enviado pelo cliente ou no mimetype declarado
// no multipart form-data — ambos são strings livres, controladas por quem faz o
// upload, e nunca eram cruzadas com o conteúdo real do arquivo (achado CRÍTICO 5.3 da
// auditoria de segurança). Sem essa checagem dava pra subir um .html/.js disfarçado
// de foto e servir conteúdo malicioso no próprio domínio via /uploads — express.static
// decide o Content-Type da resposta pela EXTENSÃO do arquivo salvo em disco, e até
// aqui a extensão salva vinha direto de path.extname(file.originalname).
//
// Cada assinatura mapeia pra um tipo canônico + extensão + mimetype "verdadeiros" —
// são esses três valores que devem ser usados dali em diante (nome final do arquivo
// em disco, checagem contra a lista de tipos permitidos daquele endpoint), nunca o
// que veio do cliente.
const ASSINATURAS = [
  { tipo: 'jpeg', extensao: '.jpg', mimetype: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { tipo: 'png', extensao: '.png', mimetype: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { tipo: 'webm', extensao: '.webm', mimetype: 'video/webm', bytes: [0x1A, 0x45, 0xDF, 0xA3] }
];

const bufferComecaCom = (buffer, bytes) => bytes.every((byte, i) => buffer[i] === byte);

// MP4/MOV não têm um byte mágico logo no início: os primeiros 4 bytes são o tamanho
// da box (variável) e só os bytes 4-8 são fixos ('ftyp'). O "major brand" nos bytes
// 8-12 é o que diferencia MOV (gravado nativamente no iPhone) de MP4 (demais
// origens/o MediaRecorder do navegador) — ambos compartilham o mesmo container ISO
// base media, então sem olhar o brand os dois seriam indistinguíveis.
const detectarFtyp = (buffer) => {
  if (buffer.length < 12) return null;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = buffer.toString('ascii', 8, 12).trim().toLowerCase();
  if (brand === 'qt') {
    return { tipo: 'mov', extensao: '.mov', mimetype: 'video/quicktime' };
  }
  return { tipo: 'mp4', extensao: '.mp4', mimetype: 'video/mp4' };
};

// Lê os primeiros bytes do arquivo já salvo em disco e devolve o tipo real
// detectado ({ tipo, extensao, mimetype }) ou null se não bater com nenhuma
// assinatura conhecida (arquivo corrompido, tipo não suportado, ou alguém
// tentando disfarçar outra coisa como imagem/vídeo).
const detectarTipoReal = (caminhoArquivo) => {
  const fd = fs.openSync(caminhoArquivo, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const lidos = fs.readSync(fd, buffer, 0, 16, 0);
    if (lidos < 4) return null;

    const ftyp = detectarFtyp(buffer);
    if (ftyp) return ftyp;

    for (const assinatura of ASSINATURAS) {
      if (bufferComecaCom(buffer, assinatura.bytes)) {
        return { tipo: assinatura.tipo, extensao: assinatura.extensao, mimetype: assinatura.mimetype };
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
};

// Valida o arquivo já salvo em `caminhoArquivo` contra a lista de tipos permitidos
// nesse endpoint específico (ex: ['jpeg','png'] pra foto de perfil, ou
// ['jpeg','png','mp4','webm','mov'] pra story). Em caso de sucesso, RENOMEIA o
// arquivo em disco pra usar a extensão real detectada (nunca a que veio do
// cliente) e devolve o novo caminho/nome. Em caso de falha (tipo não detectado OU
// detectado mas não permitido nesse endpoint), APAGA o arquivo — quem chama não
// precisa limpar o arquivo temporário no caminho de erro.
const validarAssinaturaArquivo = (caminhoArquivo, tiposPermitidos) => {
  const detectado = detectarTipoReal(caminhoArquivo);

  if (!detectado || !tiposPermitidos.includes(detectado.tipo)) {
    fs.unlink(caminhoArquivo, () => {});
    return { valido: false, tipo: detectado ? detectado.tipo : null };
  }

  const diretorio = path.dirname(caminhoArquivo);
  const nomeBase = path.basename(caminhoArquivo, path.extname(caminhoArquivo));
  const novoCaminho = path.join(diretorio, nomeBase + detectado.extensao);

  fs.renameSync(caminhoArquivo, novoCaminho);

  return {
    valido: true,
    tipo: detectado.tipo,
    extensao: detectado.extensao,
    mimetype: detectado.mimetype,
    caminho: novoCaminho,
    nomeArquivo: path.basename(novoCaminho)
  };
};

module.exports = { validarAssinaturaArquivo };
