const Usuario = require('../models/Usuario');
const FotoPerfil = require('../models/FotoPerfil');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { compararRostos } = require('../utils/rekognition');
const { creditarBonusIndicacaoSeAplicavel } = require('./livenessController');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
          const pasta = 'uploads/';
          if (!fs.existsSync(pasta)) {
                  fs.mkdirSync(pasta, { recursive: true });
          }
          cb(null, pasta);
    },
    filename: (req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, crypto.randomUUID() + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
          const tipos = /jpeg|jpg|png/;
          const valido = tipos.test(file.mimetype);
          if (valido) cb(null, true);
          else cb(new Error('Apenas imagens JPG e PNG são permitidas'));
    }
});

const GENEROS_VALIDOS = ['masculino', 'feminino', 'nao-binario'];
const PREF_GENERO_VALIDOS = ['masculino', 'feminino', 'todos'];

const removerTagsHtml = (texto) => String(texto).replace(/<[^>]*>/g, '').trim();

const editarPerfil = async (req, res) => {
    try {
          const {
                  nome, bio, genero, data_nascimento, cidade, objetivo, signo,
                  altura, peso, cor_cabelo, instagram_handle, estilo_vida, interesses, prompts,
                  pref_genero, pref_idade_min, pref_idade_max, pref_distancia_km,
                  pref_altura_min, pref_altura_max, pref_peso_min, pref_peso_max, pref_cor_cabelo,
                  pref_apenas_verificados, pref_objetivo
          } = req.body;

      const usuario_id = req.usuarioId;
          const dados = {};

      if (nome !== undefined) {
              const nomeLimpo = removerTagsHtml(nome).slice(0, 100);
              if (!nomeLimpo) {
                        return res.status(400).json({ erro: 'O nome não pode ficar vazio.' });
              }
              dados.nome = nomeLimpo;
      }

      if (bio !== undefined) dados.bio = removerTagsHtml(bio).slice(0, 500);

      if (genero !== undefined) {
              if (genero && !GENEROS_VALIDOS.includes(genero)) {
                        return res.status(400).json({ erro: 'Gênero inválido.' });
              }
              dados.genero = genero || null;
      }

      if (data_nascimento) dados.data_nascimento = data_nascimento;
          if (cidade !== undefined) dados.cidade = removerTagsHtml(cidade).slice(0, 100) || null;
          if (objetivo !== undefined) dados.objetivo = objetivo || null;
          if (signo !== undefined) dados.signo = signo || null;
          if (estilo_vida !== undefined) dados.estilo_vida = estilo_vida;
          if (interesses !== undefined) dados.interesses = interesses;

      if (prompts !== undefined) {
              dados.prompts = Array.isArray(prompts)
                ? prompts.map(p => ({ pergunta: p.pergunta, resposta: removerTagsHtml(p.resposta || '').slice(0, 200) }))
                        : prompts;
      }

      if (altura !== undefined) dados.altura = altura || null;
          if (peso !== undefined) dados.peso = peso || null;
          if (cor_cabelo !== undefined) dados.cor_cabelo = cor_cabelo || null;

      if (instagram_handle !== undefined) {
              if (!instagram_handle) {
                        dados.instagram_handle = null;
              } else {
                        const limpo = String(instagram_handle).trim()
                          .replace(/^@/, '')
                          .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
                          .split('/')[0].split('?')[0];
                        if (!/^[a-zA-Z0-9._]{1,30}$/.test(limpo)) {
                                    return res.status(400).json({ erro: 'Instagram inválido. Use apenas o @usuario (letras, números, pontos e underline).' });
                        }
                        dados.instagram_handle = limpo.toLowerCase();
              }
      }

      if (pref_genero !== undefined) {
              if (pref_genero && !PREF_GENERO_VALIDOS.includes(pref_genero)) {
                        return res.status(400).json({ erro: 'Preferência de gênero inválida.' });
              }
              dados.pref_genero = pref_genero || null;
      }

      if (pref_idade_min !== undefined) dados.pref_idade_min = pref_idade_min || 18;
          if (pref_idade_max !== undefined) dados.pref_idade_max = pref_idade_max || 99;
          if (pref_distancia_km !== undefined) dados.pref_distancia_km = pref_distancia_km || 50;
          if (pref_altura_min !== undefined) dados.pref_altura_min = pref_altura_min || null;
          if (pref_altura_max !== undefined) dados.pref_altura_max = pref_altura_max || null;
          if (pref_peso_min !== undefined) dados.pref_peso_min = pref_peso_min || null;
          if (pref_peso_max !== undefined) dados.pref_peso_max = pref_peso_max || null;
          if (pref_cor_cabelo !== undefined) dados.pref_cor_cabelo = pref_cor_cabelo || null;
          if (pref_apenas_verificados !== undefined) dados.pref_apenas_verificados = !!pref_apenas_verificados;
          if (pref_objetivo !== undefined) dados.pref_objetivo = pref_objetivo || null;

      await Usuario.update(dados, { where: { id: usuario_id } });

      const usuario = await Usuario.findByPk(usuario_id, {
              attributes: { exclude: ['senha', 'foto_verificacao'] }
      });

      res.json({ mensagem: 'Perfil atualizado!', usuario });
    } catch (erro) {
          console.error('Erro ao editar perfil:', erro);
          res.status(500).json({ erro: 'Não foi possível salvar as alterações. Tente novamente.' });
    }
};

// Mantém a tabela FotoPerfil sincronizada com Usuario.foto_url. A foto principal
// é sempre a linha com ordem 0 (mesma convenção usada em adicionarFotoGaleria e
// removerFotoGaleria). Se ainda não existe linha com ordem 0 pra esse usuário,
// cria uma; se já existe (troca de foto principal), só atualiza a url — nunca
// duplica linha, mesmo que o usuário troque de foto várias vezes.
const sincronizarFotoPrincipalNaGaleria = async (usuarioId, url) => {
    const [fotoPrincipal, criada] = await FotoPerfil.findOrCreate({
          where: { usuario_id: usuarioId, ordem: 0 },
          defaults: { url }
    });
    if (!criada && fotoPrincipal.url !== url) {
          fotoPrincipal.url = url;
          await fotoPrincipal.save();
    }
};

const uploadFoto = async (req, res) => {
    try {
          if (!req.file) {
                  return res.status(400).json({ erro: 'Nenhuma foto enviada' });
          }

          const usuarioAtual = await Usuario.findByPk(req.usuarioId);
          if (!usuarioAtual) {
                  fs.unlink(req.file.path, () => {});
                  return res.status(404).json({ erro: 'Usuário não encontrado.' });
          }

          const foto_url = '/uploads/' + req.file.filename;
          const primeiraFotoDePerfil = !usuarioAtual.foto_url;

          // Só compara com a referência do liveness na PRIMEIRA vez que o usuário define
          // a foto de perfil principal, e só se ele já tiver passado pelo liveness antes.
          // Trocas posteriores da foto principal não comparam de novo (custo de API) —
          // e fotos da galeria nunca passam por essa checagem.
          if (primeiraFotoDePerfil && usuarioAtual.liveness_aprovado && usuarioAtual.foto_referencia_liveness) {
                  const caminhoReferencia = path.join(__dirname, '..', usuarioAtual.foto_referencia_liveness.replace(/^\//, ''));

                  let comparacao;
                  try {
                          comparacao = await compararRostos(req.file.path, caminhoReferencia);
                  } catch (erroComparacao) {
                          fs.unlink(req.file.path, () => {});
                          return res.status(503).json({ erro: 'Não foi possível concluir a verificação agora. Tente novamente em instantes: ' + erroComparacao.message });
                  }

                  if (!comparacao.bateu) {
                          fs.unlink(req.file.path, () => {});
                          return res.status(400).json({
                                  erro: 'Não foi possível confirmar que é você nessa foto. Tenta outra.',
                                  motivo: comparacao.motivo
                          });
                  }

                  await Usuario.update(
                        { foto_url, verificado: true },
                        { where: { id: req.usuarioId } }
                              );
                  await sincronizarFotoPrincipalNaGaleria(req.usuarioId, foto_url);

                  // ===== REFERRAL ANTIGO (bônus de 7 dias Premium) — DESLIGADO =====
                  // Este era o único gatilho que concedia o bônus: ao confirmar a
                  // identidade, creditava 7 dias de Premium a quem indicou.
                  // Desativado porque o programa foi substituído pelo Programa de
                  // Parceiros (comissão em R$). Confirmado no banco antes de
                  // desligar: total_indicados = 0 e bonus_pendentes = 0, ou seja,
                  // ninguém perdeu crédito já prometido.
                  //
                  // Mantido comentado de propósito (e não removido) porque o resto
                  // do sistema antigo segue de pé por ora: a função
                  // creditarBonusIndicacaoSeAplicavel, os campos indicado_por e
                  // bonus_indicacao_creditado, a rota GET /api/perfil/indicacoes e a
                  // tela screen-indica. Religar é descomentar esta linha.
                  //
                  // ATENÇÃO: codigo_indicacao NÃO faz parte deste desligamento —
                  // ele continua sendo gerado no cadastro e é usado pelo sistema de
                  // Duplas (duplaController.convidarParceiro).
                  //
                  // const usuarioVerificado = await Usuario.findByPk(req.usuarioId);
                  // await creditarBonusIndicacaoSeAplicavel(usuarioVerificado);

                  return res.json({ mensagem: 'Foto atualizada e identidade confirmada!', foto_url });
          }

          await Usuario.update(
            { foto_url },
            { where: { id: req.usuarioId } }
                );
          await sincronizarFotoPrincipalNaGaleria(req.usuarioId, foto_url);
          res.json({ mensagem: 'Foto atualizada com sucesso!', foto_url });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao fazer upload: ' + erro.message });
    }
};

const atualizarLocalizacao = async (req, res) => {
    try {
          const { latitude, longitude } = req.body;
          await Usuario.update(
            { latitude, longitude },
            { where: { id: req.usuarioId } }
                );
          res.json({ mensagem: 'Localização atualizada!' });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao atualizar localização: ' + erro.message });
    }
};

const estatisticasIndicacao = async (req, res) => {
    try {
          const usuario = await Usuario.findByPk(req.usuarioId);
          const indicados = await Usuario.findAll({
                  where: { indicado_por: usuario.codigo_indicacao },
                  attributes: ['id', 'nome', 'verificado', 'createdAt']
          });
          const verificados = indicados.filter(i => i.verificado).length;
          res.json({
                  codigo_indicacao: usuario.codigo_indicacao,
                  total_indicados: indicados.length,
                  indicados_verificados: verificados,
                  dias_premium_ganhos: verificados * 7
          });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao buscar indicações: ' + erro.message });
    }
};

const MAX_FOTOS_GALERIA = 7;

const listarFotosGaleria = async (req, res) => {
    try {
          const fotos = await FotoPerfil.findAll({
                  where: { usuario_id: req.usuarioId },
                  order: [['ordem', 'ASC']]
          });
          res.json({ fotos, limite: MAX_FOTOS_GALERIA });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao listar fotos: ' + erro.message });
    }
};

const adicionarFotoGaleria = async (req, res) => {
    try {
          if (!req.file) {
                  return res.status(400).json({ erro: 'Nenhuma foto enviada' });
          }

          // A galeria não pode ser usada pra definir a primeira foto de perfil — isso
          // pularia a comparação facial com a referência do liveness, que só acontece
          // na rota principal (uploadFoto). Só libera a galeria pra quem já tem foto_url.
          const usuarioAtual = await Usuario.findByPk(req.usuarioId);
          if (!usuarioAtual || !usuarioAtual.foto_url) {
                  fs.unlink(req.file.path, () => {});
                  return res.status(400).json({ erro: 'Defina sua foto de perfil principal antes de adicionar fotos à galeria.' });
          }

          const totalAtual = await FotoPerfil.count({ where: { usuario_id: req.usuarioId } });
          if (totalAtual >= MAX_FOTOS_GALERIA) {
                  fs.unlink(req.file.path, () => {});
                  return res.status(400).json({ erro: `Você já tem o máximo de ${MAX_FOTOS_GALERIA} fotos` });
          }

      // Fotos da galeria (incluindo a primeira) NUNCA passam por comparação facial —
      // isso agora acontece só uma vez, na foto de perfil principal (uploadFoto),
      // logo depois do liveness. Aqui é aceitar livremente; a moderação da
      // comunidade (denúncias) cobre esse caso depois.
      const ehFotoPrincipal = totalAtual === 0;

      const url = '/uploads/' + req.file.filename;
          const foto = await FotoPerfil.create({ usuario_id: req.usuarioId, url, ordem: totalAtual });

      if (ehFotoPrincipal) {
              await Usuario.update({ foto_url: url }, { where: { id: req.usuarioId } });
      }

      res.status(201).json({ mensagem: 'Foto adicionada!', foto, total: totalAtual + 1 });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao adicionar foto: ' + erro.message });
    }
};

const removerFotoGaleria = async (req, res) => {
    try {
          const { id } = req.params;
          const foto = await FotoPerfil.findOne({ where: { id, usuario_id: req.usuarioId } });
          if (!foto) return res.status(404).json({ erro: 'Foto não encontrada' });

      const eraOrdemZero = foto.ordem === 0;
          await foto.destroy();

      const restantes = await FotoPerfil.findAll({
              where: { usuario_id: req.usuarioId },
              order: [['ordem', 'ASC']]
      });

      for (let i = 0; i < restantes.length; i++) {
              if (restantes[i].ordem !== i) {
                        restantes[i].ordem = i;
                        await restantes[i].save();
              }
      }

      if (eraOrdemZero) {
              const novaPrimeira = restantes[0];
              await Usuario.update(
                { foto_url: novaPrimeira ? novaPrimeira.url : null },
                { where: { id: req.usuarioId } }
                      );
      }

      res.json({ mensagem: 'Foto removida!' });
    } catch (erro) {
          res.status(500).json({ erro: 'Erro ao remover foto: ' + erro.message });
    }
};

module.exports = {
    editarPerfil, uploadFoto, upload, atualizarLocalizacao, estatisticasIndicacao,
    listarFotosGaleria, adicionarFotoGaleria, removerFotoGaleria
};
