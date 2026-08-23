-- FIX_CASCADE_PARCEIROS.sql
--
-- Corrige as FKs do Programa de Parceiros que ficaram sem ON DELETE CASCADE
-- de verdade no banco de produção.
--
-- Causa raiz: PROGRAMA_PARCEIROS.sql cria as tabelas parceiros, indicacoes,
-- comissoes e bonus_metas com "CREATE TABLE IF NOT EXISTS ... CONSTRAINT
-- ... FOREIGN KEY ... ON DELETE CASCADE". Só que essas tabelas já existiam
-- em produção — criadas antes por um sequelize.sync() sem as associações
-- (que só passaram a declarar onDelete: 'CASCADE' depois, em
-- models/associacoes.js). Como a tabela já existia, o CREATE TABLE IF NOT
-- EXISTS inteiro virou um no-op silencioso, incluindo a constraint embutida
-- — e o Postgres ficou com a FK que ELE criou sozinho antes (sem CASCADE,
-- com o nome automático "<tabela>_<coluna>_fkey").
--
-- Isso bloqueava a exclusão de conta (LGPD) de qualquer usuário que fosse
-- parceiro do Programa de Parceiros: ERROR: update or delete on table
-- "usuarios" violates foreign key constraint "parceiros_usuario_id_fkey".
--
-- Este script é idempotente: pode rodar quantas vezes for preciso, em
-- qualquer estado (constraint antiga presente, já corrigida, ou tabela
-- nova que já nasceu certa) sem erro e sem duplicar nada.
--
-- Rodar UMA VEZ no Query editor do Postgres (Railway).

BEGIN;

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('parceiros',   'usuario_id',          'usuarios',   'parceiros_usuario_id_fkey',          'fk_parceiros_usuario'),
    ('indicacoes',  'parceiro_id',         'parceiros',  'indicacoes_parceiro_id_fkey',         'fk_indicacoes_parceiro'),
    ('indicacoes',  'usuario_indicado_id', 'usuarios',   'indicacoes_usuario_indicado_id_fkey', 'fk_indicacoes_usuario_indicado'),
    ('comissoes',   'parceiro_id',         'parceiros',  'comissoes_parceiro_id_fkey',          'fk_comissoes_parceiro'),
    ('comissoes',   'indicacao_id',        'indicacoes', 'comissoes_indicacao_id_fkey',         'fk_comissoes_indicacao'),
    ('bonus_metas', 'parceiro_id',         'parceiros',  'bonus_metas_parceiro_id_fkey',        'fk_bonus_metas_parceiro')
  ) AS t(tabela, coluna, tabela_ref, nome_antigo, nome_novo)
  LOOP
    -- Remove a constraint antiga (auto-gerada pelo Postgres, sem CASCADE) se existir.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome_antigo) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.tabela, fk.nome_antigo);
    END IF;

    -- Cria a constraint nova, já com CASCADE, só se ainda não existir
    -- (idempotência: uma segunda execução deste script não faz nada aqui).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome_novo) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE',
        fk.tabela, fk.nome_novo, fk.coluna, fk.tabela_ref
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
