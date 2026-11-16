CREATE TABLE IF NOT EXISTS public.regras_folga_escalas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo text NOT NULL UNIQUE,
    nome text NOT NULL,
    padrao_ciclo text NOT NULL,
    ativa boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT regras_folga_escalas_codigo_format CHECK (codigo ~ '^[a-z0-9_-]{2,30}$'),
    CONSTRAINT regras_folga_escalas_nome_not_empty CHECK (length(trim(nome)) > 0),
    CONSTRAINT regras_folga_escalas_padrao_format CHECK (
        length(padrao_ciclo) BETWEEN 2 AND 56
        AND padrao_ciclo ~ '^[TF]+$'
        AND padrao_ciclo ~ 'T'
        AND padrao_ciclo ~ 'F'
    )
);

INSERT INTO public.regras_folga_escalas (codigo, nome, padrao_ciclo)
VALUES
    ('5x1', '5x1 contínuo', 'TTTTTF'),
    ('6x1', '6x1 contínuo', 'TTTTTTF')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.escalas_operacionais (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo text NOT NULL UNIQUE,
    motorista_titular_id uuid NOT NULL REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
    regra_folga_id uuid REFERENCES public.regras_folga_escalas (id) ON DELETE SET NULL,
    inicio_vigencia date NOT NULL DEFAULT CURRENT_DATE,
    fim_vigencia date,
    observacao text,
    user_id uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT escalas_operacionais_codigo_format CHECK (codigo ~ '^[0-9]{4}\.[0-9]{2}[A-Z]?$'),
    CONSTRAINT escalas_operacionais_vigencia_check CHECK (
        fim_vigencia IS NULL OR fim_vigencia >= inicio_vigencia
    )
);

ALTER TABLE public.escalas_trabalho
    ADD COLUMN IF NOT EXISTS escala_operacional_id uuid
        REFERENCES public.escalas_operacionais (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS motorista_substituto_id uuid
        REFERENCES public.funcionarios (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS escalas_trabalho_escala_operacional_data_idx
    ON public.escalas_trabalho (escala_operacional_id, data_escala, hora_inicio);

CREATE OR REPLACE FUNCTION public.validar_viagem_escala_titular()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_titular_id uuid;
    v_inicio date;
    v_fim date;
BEGIN
    IF NEW.escala_operacional_id IS NULL THEN
        IF NEW.motorista_substituto_id IS NOT NULL THEN
            RAISE EXCEPTION 'A substituição precisa estar vinculada a uma escala operacional.';
        END IF;
        RETURN NEW;
    END IF;

    SELECT motorista_titular_id, inicio_vigencia, fim_vigencia
    INTO v_titular_id, v_inicio, v_fim
    FROM public.escalas_operacionais
    WHERE id = NEW.escala_operacional_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A escala operacional selecionada não existe.';
    END IF;

    IF NEW.motorista_id IS DISTINCT FROM v_titular_id THEN
        RAISE EXCEPTION 'A viagem vinculada deve manter o motorista titular da escala.';
    END IF;

    IF NEW.motorista_substituto_id = v_titular_id THEN
        RAISE EXCEPTION 'O substituto deve ser diferente do motorista titular.';
    END IF;

    IF NEW.data_escala < v_inicio OR (v_fim IS NOT NULL AND NEW.data_escala > v_fim) THEN
        RAISE EXCEPTION 'A data da viagem deve estar dentro da vigência da escala.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_viagem_escala_titular ON public.escalas_trabalho;
CREATE TRIGGER validar_viagem_escala_titular
BEFORE INSERT OR UPDATE OF escala_operacional_id, motorista_id, motorista_substituto_id, data_escala
ON public.escalas_trabalho
FOR EACH ROW EXECUTE FUNCTION public.validar_viagem_escala_titular();
REVOKE ALL ON FUNCTION public.validar_viagem_escala_titular() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_atualizacao_escala_operacional()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.escalas_trabalho e
        WHERE e.escala_operacional_id = OLD.id
          AND (
              e.motorista_id IS DISTINCT FROM NEW.motorista_titular_id
              OR e.data_escala < NEW.inicio_vigencia
              OR (NEW.fim_vigencia IS NOT NULL AND e.data_escala > NEW.fim_vigencia)
          )
    ) OR EXISTS (
        SELECT 1
        FROM public.folgas_escalas f
        WHERE f.escala_operacional_id = OLD.id
          AND (
              f.data_folga < NEW.inicio_vigencia
              OR (NEW.fim_vigencia IS NOT NULL AND f.data_folga > NEW.fim_vigencia)
          )
    ) OR EXISTS (
        SELECT 1
        FROM public.substituicoes_escalas s
        WHERE s.escala_operacional_id = OLD.id
          AND (
              s.data_substituicao < NEW.inicio_vigencia
              OR (NEW.fim_vigencia IS NOT NULL AND s.data_substituicao > NEW.fim_vigencia)
              OR s.motorista_substituto_id = NEW.motorista_titular_id
          )
    ) THEN
        RAISE EXCEPTION 'Não é possível alterar titular ou vigência enquanto houver viagens, folgas ou substituições incompatíveis.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_atualizacao_escala_operacional ON public.escalas_operacionais;
CREATE TRIGGER validar_atualizacao_escala_operacional
BEFORE UPDATE OF motorista_titular_id, inicio_vigencia, fim_vigencia
ON public.escalas_operacionais
FOR EACH ROW EXECUTE FUNCTION public.validar_atualizacao_escala_operacional();
REVOKE ALL ON FUNCTION public.validar_atualizacao_escala_operacional() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.folgas_escalas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_operacional_id uuid NOT NULL
        REFERENCES public.escalas_operacionais (id) ON DELETE CASCADE,
    data_folga date NOT NULL,
    tipo text NOT NULL DEFAULT 'folga',
    observacao text,
    user_id uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT folgas_escalas_tipo_check CHECK (tipo IN ('folga', 'trabalho')),
    UNIQUE (escala_operacional_id, data_folga)
);

CREATE TABLE IF NOT EXISTS public.substituicoes_escalas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_operacional_id uuid NOT NULL
        REFERENCES public.escalas_operacionais (id) ON DELETE CASCADE,
    data_substituicao date NOT NULL,
    motorista_substituto_id uuid NOT NULL
        REFERENCES public.funcionarios (id) ON DELETE RESTRICT,
    observacao text,
    user_id uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (escala_operacional_id, data_substituicao)
);

CREATE OR REPLACE FUNCTION public.validar_substituicao_escala()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_titular_id uuid;
    v_inicio date;
    v_fim date;
BEGIN
    SELECT motorista_titular_id, inicio_vigencia, fim_vigencia
    INTO v_titular_id, v_inicio, v_fim
    FROM public.escalas_operacionais
    WHERE id = NEW.escala_operacional_id;

    IF NOT FOUND OR NEW.data_substituicao < v_inicio
       OR (v_fim IS NOT NULL AND NEW.data_substituicao > v_fim) THEN
        RAISE EXCEPTION 'A substituição deve ocorrer durante a vigência da escala.';
    END IF;

    IF NEW.motorista_substituto_id = v_titular_id THEN
        RAISE EXCEPTION 'O substituto deve ser diferente do motorista titular.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_substituicao_escala ON public.substituicoes_escalas;
CREATE TRIGGER validar_substituicao_escala
BEFORE INSERT OR UPDATE OF escala_operacional_id, data_substituicao, motorista_substituto_id
ON public.substituicoes_escalas
FOR EACH ROW EXECUTE FUNCTION public.validar_substituicao_escala();
REVOKE ALL ON FUNCTION public.validar_substituicao_escala() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_data_excecao_folga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inicio date;
    v_fim date;
BEGIN
    SELECT inicio_vigencia, fim_vigencia
    INTO v_inicio, v_fim
    FROM public.escalas_operacionais
    WHERE id = NEW.escala_operacional_id;

    IF NOT FOUND OR NEW.data_folga < v_inicio OR (v_fim IS NOT NULL AND NEW.data_folga > v_fim) THEN
        RAISE EXCEPTION 'A data da exceção deve estar dentro da vigência da escala.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_data_excecao_folga ON public.folgas_escalas;
CREATE TRIGGER validar_data_excecao_folga
BEFORE INSERT OR UPDATE OF escala_operacional_id, data_folga
ON public.folgas_escalas
FOR EACH ROW EXECUTE FUNCTION public.validar_data_excecao_folga();
REVOKE ALL ON FUNCTION public.validar_data_excecao_folga() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.regras_folga_escalas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalas_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folgas_escalas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substituicoes_escalas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regras_folga_select_authenticated" ON public.regras_folga_escalas;
DROP POLICY IF EXISTS "regras_folga_manage_ti" ON public.regras_folga_escalas;
CREATE POLICY "regras_folga_select_authenticated"
ON public.regras_folga_escalas FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));
CREATE POLICY "regras_folga_manage_ti"
ON public.regras_folga_escalas FOR ALL TO authenticated
USING (public.current_user_sector() = 'TI')
WITH CHECK (public.current_user_sector() = 'TI');

DROP POLICY IF EXISTS "escalas_operacionais_select_allowed_sectors" ON public.escalas_operacionais;
DROP POLICY IF EXISTS "escalas_operacionais_insert_allowed_sectors" ON public.escalas_operacionais;
DROP POLICY IF EXISTS "escalas_operacionais_update_allowed_sectors" ON public.escalas_operacionais;
DROP POLICY IF EXISTS "escalas_operacionais_delete_allowed_sectors" ON public.escalas_operacionais;
CREATE POLICY "escalas_operacionais_select_allowed_sectors"
ON public.escalas_operacionais FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));
CREATE POLICY "escalas_operacionais_insert_allowed_sectors"
ON public.escalas_operacionais FOR INSERT TO authenticated
WITH CHECK (
    public.current_user_sector() IN ('Administração', 'Operacional', 'TI')
    AND user_id = auth.uid()
);
CREATE POLICY "escalas_operacionais_update_allowed_sectors"
ON public.escalas_operacionais FOR UPDATE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'))
WITH CHECK (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));
CREATE POLICY "escalas_operacionais_delete_allowed_sectors"
ON public.escalas_operacionais FOR DELETE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));

DROP POLICY IF EXISTS "folgas_escalas_select_allowed_sectors" ON public.folgas_escalas;
DROP POLICY IF EXISTS "folgas_escalas_manage_allowed_sectors" ON public.folgas_escalas;
CREATE POLICY "folgas_escalas_select_allowed_sectors"
ON public.folgas_escalas FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));
CREATE POLICY "folgas_escalas_manage_allowed_sectors"
ON public.folgas_escalas FOR ALL TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'))
WITH CHECK (
    public.current_user_sector() IN ('Administração', 'Operacional', 'TI')
    AND user_id = auth.uid()
);

DROP POLICY IF EXISTS "substituicoes_escalas_select_allowed_sectors" ON public.substituicoes_escalas;
DROP POLICY IF EXISTS "substituicoes_escalas_manage_allowed_sectors" ON public.substituicoes_escalas;
CREATE POLICY "substituicoes_escalas_select_allowed_sectors"
ON public.substituicoes_escalas FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));
CREATE POLICY "substituicoes_escalas_manage_allowed_sectors"
ON public.substituicoes_escalas FOR ALL TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'))
WITH CHECK (
    public.current_user_sector() IN ('Administração', 'Operacional', 'TI')
    AND user_id = auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.regras_folga_escalas, public.escalas_operacionais, public.folgas_escalas, public.substituicoes_escalas,
   public.escalas_trabalho
TO authenticated;

NOTIFY pgrst, 'reload schema';
