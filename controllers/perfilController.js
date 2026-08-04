const uploadFoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhuma foto enviada' });
    }
    const foto_url = '/uploads/' + req.file.filename;
    await Usuario.update(
      { foto_url },
      { where: { id: req.usuarioId } }
    );
    res.json({ mensagem: 'Foto atualizada com sucesso!', foto_url });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao fazer upload: ' + erro.message });
  }
};

const atualizarLocalizacao = async (req, res) => {
  ...



    const usuarioAtual = await Usuario.findByPk(req.usuarioId);
    if (!usuarioAtual.foto_url) {
      // Apaga a selfie recebida já que não dá pra usar
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ erro: 'Cadastre uma foto de perfil antes de fazer a verificação facial' });
    }

    const caminhoSelfie = req.file.path;
    const caminhoFotoPerfil = path.join(__dirname, '..', usuarioAtual.foto_url.replace(/^\//, ''));

    let resultadoComparacao;
    try {
      resultadoComparacao = await compararRostos(caminhoSelfie, caminhoFotoPerfil);
    } catch (erroComparacao) {
      fs.unlink(req.file.path, () => {});
      return res.status(503).json({ erro: 'Não foi possível concluir a verificação facial agora. Tente novamente em instantes: ' + erroComparacao.message });
    }

    if (!resultadoComparacao.bateu) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        erro: 'Não foi possível confirmar que é a mesma pessoa da foto de perfil.',
        motivo: resultadoComparacao.motivo,
        similaridade: resultadoComparacao.similaridade
      });
    }

    const foto_verificacao = '/uploads/' + req.file.filename;
    await Usuario.update(
      { foto_verificacao, verificado: true },
      { where: { id: req.usuarioId } }
    );

    const usuarioVerificado = await Usuario.findByPk(req.usuarioId);
    if (usuarioVerificado.indicado_por && !usuarioVerificado.bonus_indicacao_creditado) {
      const referenciador = await Usuario.findOne({ where: { codigo_indicacao: usuarioVerificado.indicado_por } });
      if (referenciador) {
        // Se o indicador já tem premium sem data de expiracao (fase gratuita atual),
        // nao faz sentido "trocar" isso por um prazo de 7 dias - isso rebaixaria
        // quem deveria estar sendo recompensado. Só estende quem já está num plano
        // com data de expiração de verdade (fase paga).
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
    }

    const usuario = await Usuario.findByPk(req.usuarioId, {
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });
    res.json({ mensagem: 'Perfil verificado!', usuario });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar: ' + erro.message });
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

    const totalAtual = await FotoPerfil.count({ where: { usuario_id: req.usuarioId } });
    if (totalAtual >= MAX_FOTOS_GALERIA) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ erro: `Você já tem o máximo de ${MAX_FOTOS_GALERIA} fotos` });
    }

    // Só verifica a foto principal (a primeira) contra a verificação de identidade.
    // As demais entram sem checagem, pra não multiplicar o custo de comparação facial.
    const ehFotoPrincipal = totalAtual === 0;

    if (ehFotoPrincipal) {
      const usuarioAtual = await Usuario.findByPk(req.usuarioId);
      if (usuarioAtual.foto_verificacao) {
        let resultadoComparacao;
        try {
          const caminhoFotoVerificacao = path.join(__dirname, '..', usuarioAtual.foto_verificacao.replace(/^\//, ''));
          resultadoComparacao = await compararRostos(req.file.path, caminhoFotoVerificacao);
        } catch (erroComparacao) {
          fs.unlink(req.file.path, () => {});
          return res.status(503).json({ erro: 'Não foi possível verificar essa foto agora. Tente novamente em instantes: ' + erroComparacao.message });
        }
        if (!resultadoComparacao.bateu) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({
            erro: 'Essa foto não parece ser a mesma pessoa da verificação de identidade. Tente outra foto.',
            motivo: resultadoComparacao.motivo
          });
        }
      }
    }

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
