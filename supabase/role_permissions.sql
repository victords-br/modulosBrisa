ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalas_trabalho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamentos ENABLE ROW LEVEL SECURITY;

INSERT INTO public.setores (nome)
VALUES ('TI')
ON CONFLICT (nome) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_user_sector()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT s.nome
    FROM public.perfis p
    JOIN public.setores s ON s.id = p.setor_id
    WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_sector_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.setor_id
    FROM public.perfis p
    WHERE p.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_user_sector() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_sector_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_sector() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_sector_id() TO authenticated;

DROP POLICY IF EXISTS "setores_select_authenticated" ON public.setores;
DROP POLICY IF EXISTS "linhas_select_authenticated" ON public.linhas;
DROP POLICY IF EXISTS "carros_select_authenticated" ON public.carros;
DROP POLICY IF EXISTS "funcionarios_select_authenticated" ON public.funcionarios;
DROP POLICY IF EXISTS "perfis_select_own" ON public.perfis;
DROP POLICY IF EXISTS "perfis_update_own" ON public.perfis;
DROP POLICY IF EXISTS "escalas_select_authenticated" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_insert_authenticated" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_update_own" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_delete_own" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_select_allowed_sectors" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_insert_allowed_sectors" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_update_allowed_sectors" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "escalas_delete_allowed_sectors" ON public.escalas_trabalho;
DROP POLICY IF EXISTS "lancamentos_select_authenticated" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_insert_authenticated" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_update_own" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_delete_own" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_select_owner_or_finance" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_insert_own_sector" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_update_finance" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_select_allowed_sectors" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_insert_finance" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_update_allowed_sectors" ON public.lancamentos;
DROP POLICY IF EXISTS "lancamentos_delete_finance" ON public.lancamentos;

CREATE POLICY "setores_select_authenticated"
ON public.setores FOR SELECT TO authenticated
USING (true);

CREATE POLICY "linhas_select_authenticated"
ON public.linhas FOR SELECT TO authenticated
USING (true);

CREATE POLICY "carros_select_authenticated"
ON public.carros FOR SELECT TO authenticated
USING (true);

CREATE POLICY "funcionarios_select_authenticated"
ON public.funcionarios FOR SELECT TO authenticated
USING (true);

CREATE POLICY "perfis_select_own"
ON public.perfis FOR SELECT TO authenticated
USING (id = auth.uid());

CREATE POLICY "escalas_select_allowed_sectors"
ON public.escalas_trabalho FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));

CREATE POLICY "escalas_insert_allowed_sectors"
ON public.escalas_trabalho FOR INSERT TO authenticated
WITH CHECK (
    public.current_user_sector() IN ('Administração', 'Operacional', 'TI')
    AND user_id = auth.uid()
);

CREATE POLICY "escalas_update_allowed_sectors"
ON public.escalas_trabalho FOR UPDATE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'))
WITH CHECK (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));

CREATE POLICY "escalas_delete_allowed_sectors"
ON public.escalas_trabalho FOR DELETE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Operacional', 'TI'));

CREATE POLICY "lancamentos_select_allowed_sectors"
ON public.lancamentos FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'));

CREATE POLICY "lancamentos_insert_finance"
ON public.lancamentos FOR INSERT TO authenticated
WITH CHECK (
    public.current_user_sector() IN ('Administração', 'Financeiro', 'TI')
    AND user_id = auth.uid()
    AND setor_id = public.current_user_sector_id()
);

CREATE POLICY "lancamentos_update_allowed_sectors"
ON public.lancamentos FOR UPDATE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'))
WITH CHECK (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'));

CREATE POLICY "lancamentos_delete_finance"
ON public.lancamentos FOR DELETE TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'TI'));

GRANT SELECT ON public.perfis, public.setores, public.linhas, public.carros, public.funcionarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalas_trabalho TO authenticated;
REVOKE ALL ON public.lancamentos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_lancamento_role_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
     IF ROW(NEW.id, NEW.user_id, NEW.setor_id, NEW.created_at)
         IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.setor_id, OLD.created_at) THEN
        RAISE EXCEPTION 'Não é permitido alterar a identidade ou autoria do lançamento.';
    END IF;

    IF public.current_user_sector() = 'Operacional'
       AND ROW(
           NEW.data_op,
           NEW.setor_id,
           NEW.valor_garagem,
           NEW.valor_city,
           NEW.comum,
           NEW.escolar,
           NEW.pagantes,
           NEW.vt
       ) IS DISTINCT FROM ROW(
           OLD.data_op,
           OLD.setor_id,
           OLD.valor_garagem,
           OLD.valor_city,
           OLD.comum,
           OLD.escolar,
           OLD.pagantes,
           OLD.vt
       ) THEN
        RAISE EXCEPTION 'Operacional só pode alterar linha, excesso e km rodado.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lancamentos_role_fields_guard ON public.lancamentos;
CREATE TRIGGER lancamentos_role_fields_guard
BEFORE UPDATE ON public.lancamentos
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lancamento_role_fields();

CREATE OR REPLACE FUNCTION public.listar_lancamentos_dashboard(
    p_linha_id integer,
    p_data_inicio date,
    p_data_fim date
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'Operacional', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não tem acesso aos lançamentos.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT CASE
        WHEN v_setor = 'Operacional' THEN jsonb_build_object(
            'id', l.id,
            'data_op', l.data_op,
            'linha_id', l.linha_id,
            'valor_excesso', l.valor_excesso,
            'km_rodado', l.km_rodado,
            'linhas', CASE WHEN li.id IS NULL THEN NULL ELSE jsonb_build_object('nome', li.nome) END
        )
        ELSE to_jsonb(l) || jsonb_build_object(
            'linhas', CASE WHEN li.id IS NULL THEN NULL ELSE jsonb_build_object('nome', li.nome) END
        )
    END
    FROM public.lancamentos l
    LEFT JOIN public.linhas li ON li.id = l.linha_id
    WHERE (p_linha_id IS NULL OR l.linha_id = p_linha_id)
      AND (p_data_inicio IS NULL OR l.data_op >= p_data_inicio)
      AND (p_data_fim IS NULL OR l.data_op <= p_data_fim)
    ORDER BY l.data_op DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_lancamento_edicao(p_lancamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
    v_resultado jsonb;
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'Operacional', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não tem acesso aos lançamentos.' USING ERRCODE = '42501';
    END IF;

    SELECT CASE
        WHEN v_setor = 'Operacional' THEN jsonb_build_object(
            'id', l.id,
            'data_op', l.data_op,
            'linha_id', l.linha_id,
            'valor_excesso', l.valor_excesso,
            'km_rodado', l.km_rodado
        )
        ELSE to_jsonb(l)
    END
    INTO v_resultado
    FROM public.lancamentos l
    WHERE l.id = p_lancamento_id;

    IF v_resultado IS NULL THEN
        RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
    END IF;

    RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_lancamento(p_lancamento_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
    v_lancamento_id uuid;
    v_linha_id integer := nullif(p_dados->>'linha_id', '')::integer;
    v_valor_excesso numeric := coalesce(nullif(p_dados->>'valor_excesso', '')::numeric, 0);
    v_km_rodado numeric := coalesce(nullif(p_dados->>'km_rodado', '')::numeric, 0);
BEGIN
    IF jsonb_typeof(p_dados) <> 'object' THEN
        RAISE EXCEPTION 'Dados inválidos para o lançamento.' USING ERRCODE = '22023';
    END IF;

    IF p_lancamento_id IS NULL THEN
        IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'TI') THEN
            RAISE EXCEPTION 'Somente Administração e Financeiro podem criar lançamentos.' USING ERRCODE = '42501';
        END IF;

        INSERT INTO public.lancamentos (
            user_id, setor_id, data_op, linha_id, valor_garagem, valor_city,
            valor_excesso, comum, escolar, pagantes, vt, km_rodado
        ) VALUES (
            auth.uid(), public.current_user_sector_id(),
            (p_dados->>'data_op')::date, v_linha_id,
            coalesce(nullif(p_dados->>'valor_garagem', '')::numeric, 0),
            coalesce(nullif(p_dados->>'valor_city', '')::numeric, 0),
            v_valor_excesso,
            coalesce(nullif(p_dados->>'comum', '')::numeric, 0),
            coalesce(nullif(p_dados->>'escolar', '')::numeric, 0),
            coalesce(nullif(p_dados->>'pagantes', '')::numeric, 0),
            coalesce(nullif(p_dados->>'vt', '')::numeric, 0),
            v_km_rodado
        ) RETURNING id INTO v_lancamento_id;

        RETURN v_lancamento_id;
    END IF;

    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'Operacional', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não pode editar lançamentos.' USING ERRCODE = '42501';
    END IF;

    IF v_setor = 'Operacional' THEN
        UPDATE public.lancamentos
        SET linha_id = v_linha_id,
            valor_excesso = v_valor_excesso,
            km_rodado = v_km_rodado
        WHERE id = p_lancamento_id;
    ELSE
        UPDATE public.lancamentos
        SET data_op = (p_dados->>'data_op')::date,
            linha_id = v_linha_id,
            valor_garagem = coalesce(nullif(p_dados->>'valor_garagem', '')::numeric, 0),
            valor_city = coalesce(nullif(p_dados->>'valor_city', '')::numeric, 0),
            valor_excesso = v_valor_excesso,
            comum = coalesce(nullif(p_dados->>'comum', '')::numeric, 0),
            escolar = coalesce(nullif(p_dados->>'escolar', '')::numeric, 0),
            pagantes = coalesce(nullif(p_dados->>'pagantes', '')::numeric, 0),
            vt = coalesce(nullif(p_dados->>'vt', '')::numeric, 0),
            km_rodado = v_km_rodado
        WHERE id = p_lancamento_id;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
    END IF;

    RETURN p_lancamento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_lancamentos_dashboard(integer, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obter_lancamento_edicao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_lancamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_lancamentos_dashboard(integer, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_lancamento_edicao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_lancamento(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
