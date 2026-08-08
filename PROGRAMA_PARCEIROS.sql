-- ============================================================
-- Programa de Parceiros — criação de schema (PostgreSQL / Railway)
-- Rodar UMA VEZ no Query editor, em ordem.
--
-- Necessário porque em produção o index.js roda sequelize.sync() SEM
-- alter:true — ele cria tabelas que não existem, mas nunca altera as
-- existentes (por isso o ALTER TABLE de usuarios no passo 5 é obrigatório
-- e não acontece sozinho).
--
-- Tudo é idempotente (IF NOT EXISTS), então reexecutar não quebra nada.
--
-- gen_random_uuid() vem da extensão pgcrypto, nativa no PostgreSQL 13+.
-- Se o banco for mais antigo, rode antes: CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) parceiros
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parceiros (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID           NOT NULL,
  tipo              VARCHAR(255)   NOT NULL,          -- 'individual' | 'institucional'
  codigo_indicacao  VARCHAR(255)   NOT NULL UNIQUE,   -- usado no link de indicação
  status            VARCHAR(255)   NOT NULL DEFAULT 'ativo',  -- 'ativo' | 'pendente_aprovacao' | 'suspenso'
  nome_instituicao  VARCHAR(255),                     -- só quando tipo = 'institucional'
  chave_pix         VARCHAR(255),
  comissao_base     DECIMAL(10,2)  NOT NULL DEFAULT 5.00,
  data_aprovacao    TIMESTAMP WITH TIME ZONE,
  "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_parceiros_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parceiros_usuario_id ON parceiros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_parceiros_status     ON parceiros(status);

-- ------------------------------------------------------------
-- 2) indicacoes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicacoes (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id          UUID          NOT NULL,
  usuario_indicado_id  UUID          NOT NULL,
  status               VARCHAR(255)  NOT NULL DEFAULT 'ativo',  -- 'ativo' | 'cancelado' | 'inadimplente'
  plano_atual          VARCHAR(255),                            -- 'semanal' | 'mensal' | 'anual'
  data_indicacao       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  data_cancelamento    TIMESTAMP WITH TIME ZONE,
  "createdAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_indicacoes_parceiro
    FOREIGN KEY (parceiro_id) REFERENCES parceiros(id) ON DELETE CASCADE,
  CONSTRAINT fk_indicacoes_usuario_indicado
    FOREIGN KEY (usuario_indicado_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_indicacoes_parceiro_id ON indicacoes(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_status      ON indicacoes(status);

-- Um usuário só pode ter sido indicado uma vez. Sem isso, uma corrida no
-- cadastro poderia gerar duas indicações do mesmo usuário e comissão dobrada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_indicacoes_usuario_indicado
  ON indicacoes(usuario_indicado_id);

-- ------------------------------------------------------------
-- 3) comissoes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comissoes (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id       UUID          NOT NULL,
  indicacao_id      UUID          NOT NULL,
  mes_referencia    DATE          NOT NULL,
  valor             DECIMAL(10,2) NOT NULL,
  status_pagamento  VARCHAR(255)  NOT NULL DEFAULT 'pendente',  -- 'pendente' | 'pago'
  data_pagamento    TIMESTAMP WITH TIME ZONE,
  "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_comissoes_parceiro
    FOREIGN KEY (parceiro_id) REFERENCES parceiros(id) ON DELETE CASCADE,
  CONSTRAINT fk_comissoes_indicacao
    FOREIGN KEY (indicacao_id) REFERENCES indicacoes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comissoes_parceiro_id      ON comissoes(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_status_pagamento ON comissoes(status_pagamento);
CREATE INDEX IF NOT EXISTS idx_comissoes_mes_referencia   ON comissoes(mes_referencia);

-- Trava contra pagar duas vezes o mesmo mês da mesma indicação. É a proteção
-- mais importante desta migração: sem ela, rodar o job de fechamento duas
-- vezes duplica dinheiro a pagar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissoes_indicacao_mes
  ON comissoes(indicacao_id, mes_referencia);

-- ------------------------------------------------------------
-- 4) bonus_metas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bonus_metas (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  parceiro_id    UUID          NOT NULL,
  meta_usuarios  INTEGER       NOT NULL,
  prazo_dias     INTEGER       NOT NULL,
  data_inicio    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  valor_bonus    DECIMAL(10,2) NOT NULL,
  atingida       BOOLEAN       NOT NULL DEFAULT FALSE,
  data_atingida  TIMESTAMP WITH TIME ZONE,
  "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_bonus_metas_parceiro
    FOREIGN KEY (parceiro_id) REFERENCES parceiros(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bonus_metas_parceiro_id ON bonus_metas(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_bonus_metas_atingida    ON bonus_metas(atingida);

-- ------------------------------------------------------------
-- 5) usuarios: novo campo indicado_por_parceiro_id
-- ------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS indicado_por_parceiro_id UUID;

-- FK adicionada em passo separado porque ADD CONSTRAINT não aceita
-- IF NOT EXISTS no PostgreSQL — o DO block torna a reexecução segura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_usuarios_parceiro_indicador'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT fk_usuarios_parceiro_indicador
      FOREIGN KEY (indicado_por_parceiro_id) REFERENCES parceiros(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usuarios_indicado_por_parceiro
  ON usuarios(indicado_por_parceiro_id);

COMMIT;

-- ============================================================
-- Conferência rápida depois de rodar:
--
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('parceiros','indicacoes','comissoes','bonus_metas');
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'usuarios' AND column_name = 'indicado_por_parceiro_id';
-- ============================================================
