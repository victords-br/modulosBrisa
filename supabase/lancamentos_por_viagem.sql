ALTER TABLE public.lancamentos
    ADD COLUMN IF NOT EXISTS escala_id text,
    ADD COLUMN IF NOT EXISTS hora_inicio time,
    ADD COLUMN IF NOT EXISTS hora_fim time,
    ADD COLUMN IF NOT EXISTS quantidade_comum integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quantidade_escolar integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quantidade_pagantes integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quantidade_vt integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_escala_id_unique
    ON public.lancamentos (escala_id)
    WHERE escala_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.configuracao_tarifas_lancamentos (
    id smallint PRIMARY KEY CHECK (id = 1),
    valor_comum numeric(10, 2) NOT NULL DEFAULT 4.50 CHECK (valor_comum >= 0),
    valor_escolar numeric(10, 2) NOT NULL DEFAULT 2.25 CHECK (valor_escolar >= 0),
    valor_pagantes numeric(10, 2) NOT NULL DEFAULT 4.80 CHECK (valor_pagantes >= 0),
    valor_vt numeric(10, 2) NOT NULL DEFAULT 4.50 CHECK (valor_vt >= 0),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.configuracao_tarifas_lancamentos (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracao_tarifas_lancamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tarifas_lancamentos_select_ti" ON public.configuracao_tarifas_lancamentos;
CREATE POLICY "tarifas_lancamentos_select_ti"
ON public.configuracao_tarifas_lancamentos FOR SELECT TO authenticated
USING (public.current_user_sector() = 'TI');

REVOKE ALL ON public.configuracao_tarifas_lancamentos FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "escalas_select_allowed_sectors" ON public.escalas_trabalho;
CREATE POLICY "escalas_select_allowed_sectors"
ON public.escalas_trabalho FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'));

CREATE OR REPLACE FUNCTION public.obter_tarifas_lancamento()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_user_sector() IS DISTINCT FROM 'TI' THEN
        RAISE EXCEPTION 'Somente TI pode consultar as tarifas.' USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT to_jsonb(tarifas)
        FROM public.configuracao_tarifas_lancamentos tarifas
        WHERE id = 1
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_tarifas_lancamento(
    p_valor_comum numeric,
    p_valor_escolar numeric,
    p_valor_pagantes numeric,
    p_valor_vt numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_user_sector() IS DISTINCT FROM 'TI' THEN
        RAISE EXCEPTION 'Somente TI pode alterar as tarifas.' USING ERRCODE = '42501';
    END IF;

    IF p_valor_comum IS NULL OR p_valor_comum < 0
       OR p_valor_escolar IS NULL OR p_valor_escolar < 0
       OR p_valor_pagantes IS NULL OR p_valor_pagantes < 0
       OR p_valor_vt IS NULL OR p_valor_vt < 0 THEN
        RAISE EXCEPTION 'Informe tarifas válidas, iguais ou maiores que zero.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.configuracao_tarifas_lancamentos
    SET valor_comum = p_valor_comum,
        valor_escolar = p_valor_escolar,
        valor_pagantes = p_valor_pagantes,
        valor_vt = p_valor_vt,
        atualizado_em = now()
    WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_lancamentos_por_viagem(
    p_data_op date,
    p_linha_id integer,
    p_viagens jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
    v_tarifas public.configuracao_tarifas_lancamentos%ROWTYPE;
    v_viagem jsonb;
    v_escala_id text;
    v_hora_inicio time;
    v_hora_fim time;
    v_valor_garagem numeric;
    v_valor_city numeric;
    v_valor_excesso numeric;
    v_km_rodado numeric;
    v_quantidade_comum integer;
    v_quantidade_escolar integer;
    v_quantidade_pagantes integer;
    v_quantidade_vt integer;
    v_total integer := 0;
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não pode criar lançamentos por viagem.' USING ERRCODE = '42501';
    END IF;
    IF p_data_op IS NULL OR p_linha_id IS NULL OR jsonb_typeof(p_viagens) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Dados inválidos para os lançamentos por viagem.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_viagens) = 0 THEN
        RAISE EXCEPTION 'Não há viagens para lançar.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_tarifas
    FROM public.configuracao_tarifas_lancamentos
    WHERE id = 1;

    FOR v_viagem IN SELECT value FROM jsonb_array_elements(p_viagens)
    LOOP
        v_escala_id := nullif(v_viagem->>'escala_id', '');
        IF v_escala_id IS NULL THEN
            RAISE EXCEPTION 'Uma viagem está sem vínculo com a escala.' USING ERRCODE = '22023';
        END IF;

        SELECT e.hora_inicio, e.hora_fim
        INTO v_hora_inicio, v_hora_fim
        FROM public.escalas_trabalho e
        WHERE e.id::text = v_escala_id
          AND e.data_escala = p_data_op
          AND e.linha_id = p_linha_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'A viagem informada não pertence à linha e data selecionadas.' USING ERRCODE = '22023';
        END IF;

        v_valor_garagem := coalesce(nullif(v_viagem->>'valor_garagem', '')::numeric, 0);
        v_valor_city := coalesce(nullif(v_viagem->>'valor_city', '')::numeric, 0);
        v_valor_excesso := coalesce(nullif(v_viagem->>'valor_excesso', '')::numeric, 0);
        v_km_rodado := coalesce(nullif(v_viagem->>'km_rodado', '')::numeric, 0);
        v_quantidade_comum := coalesce(nullif(v_viagem->>'quantidade_comum', '')::integer, 0);
        v_quantidade_escolar := coalesce(nullif(v_viagem->>'quantidade_escolar', '')::integer, 0);
        v_quantidade_pagantes := coalesce(nullif(v_viagem->>'quantidade_pagantes', '')::integer, 0);
        v_quantidade_vt := coalesce(nullif(v_viagem->>'quantidade_vt', '')::integer, 0);

        IF v_valor_garagem < 0 OR v_valor_city < 0 OR v_valor_excesso < 0 OR v_km_rodado < 0
           OR v_quantidade_comum < 0 OR v_quantidade_escolar < 0
           OR v_quantidade_pagantes < 0 OR v_quantidade_vt < 0 THEN
            RAISE EXCEPTION 'Valores, quilometragem e quantidades não podem ser negativos.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.lancamentos (
            user_id, setor_id, data_op, linha_id, escala_id, hora_inicio, hora_fim,
            valor_garagem, valor_city, valor_excesso, comum, escolar, pagantes, vt,
            quantidade_comum, quantidade_escolar, quantidade_pagantes, quantidade_vt, km_rodado
        ) VALUES (
            auth.uid(), public.current_user_sector_id(), p_data_op, p_linha_id, v_escala_id,
            v_hora_inicio, v_hora_fim, v_valor_garagem, v_valor_city, v_valor_excesso,
            v_quantidade_comum * v_tarifas.valor_comum,
            v_quantidade_escolar * v_tarifas.valor_escolar,
            v_quantidade_pagantes * v_tarifas.valor_pagantes,
            v_quantidade_vt * v_tarifas.valor_vt,
            v_quantidade_comum, v_quantidade_escolar, v_quantidade_pagantes, v_quantidade_vt, v_km_rodado
        )
        ON CONFLICT (escala_id) WHERE escala_id IS NOT NULL
        DO UPDATE SET
            valor_garagem = EXCLUDED.valor_garagem,
            valor_city = EXCLUDED.valor_city,
            valor_excesso = EXCLUDED.valor_excesso,
            comum = EXCLUDED.comum,
            escolar = EXCLUDED.escolar,
            pagantes = EXCLUDED.pagantes,
            vt = EXCLUDED.vt,
            quantidade_comum = EXCLUDED.quantidade_comum,
            quantidade_escolar = EXCLUDED.quantidade_escolar,
            quantidade_pagantes = EXCLUDED.quantidade_pagantes,
            quantidade_vt = EXCLUDED.quantidade_vt,
            km_rodado = EXCLUDED.km_rodado,
            hora_inicio = EXCLUDED.hora_inicio,
            hora_fim = EXCLUDED.hora_fim;

        v_total := v_total + 1;
    END LOOP;

    RETURN v_total;
END;
$$;

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
            'escala_id', l.escala_id,
            'hora_inicio', l.hora_inicio,
            'hora_fim', l.hora_fim,
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
    ORDER BY l.data_op DESC, l.hora_inicio ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.obter_tarifas_lancamento() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_tarifas_lancamento(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_lancamentos_por_viagem(date, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_tarifas_lancamento() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_tarifas_lancamento(numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_lancamentos_por_viagem(date, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_lancamentos_dashboard(integer, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';