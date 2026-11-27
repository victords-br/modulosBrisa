-- Controle Financeiro: grade operacional (horários por linha e tipo de dia)
--
-- Contexto: os horários das viagens do Controle Financeiro vinham de escalas_trabalho
-- (turnos do funcionário). Esses horários não batiam com a operação real (saídas/chegadas)
-- e a escala não tem o KM do trecho. Esta migração cria a grade operacional e passa a
-- vincular cada lançamento a um TRECHO da grade.
--
-- Modelo:
--   tipos_dia          -> Úteis (1), Sábado (2), Domingo (3)
--   horarios_operacao  -> trechos por linha + tipo de dia:
--                         tabela (bloco do veículo), ida_volta (IDA/VOLTA),
--                         horário de saída/chegada, locais e distancia_km
--   lancamentos.horario_operacao_id -> vínculo 1 lançamento : 1 trecho (por data)
--
-- Regra de tipo de dia: Seg a Sex = Úteis (1) | Sábado = Sábado (2) | Domingo = Domingo (3).
-- A grade deste momento possui apenas o tipo 1 (Úteis); os demais ficam prontos para carga futura.
--
-- Execute depois de financeiro_motorista_pagantes.sql. Rode este script uma única vez.

-- 1) Tipos de dia ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tipos_dia (
    id smallint PRIMARY KEY,
    nome text NOT NULL UNIQUE
);

INSERT INTO public.tipos_dia (id, nome) VALUES
    (1, 'Úteis'),
    (2, 'Sábado'),
    (3, 'Domingo')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome;

ALTER TABLE public.tipos_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tipos_dia_select_allowed" ON public.tipos_dia;
CREATE POLICY "tipos_dia_select_allowed"
ON public.tipos_dia FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'));

-- 2) Grade operacional -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.horarios_operacao (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    linha_id integer NOT NULL REFERENCES public.linhas(id),
    tipo_dia_id smallint NOT NULL REFERENCES public.tipos_dia(id),
    tabela smallint NOT NULL,
    ida_volta text NOT NULL CHECK (ida_volta IN ('IDA', 'VOLTA')),
    horario_saida time NOT NULL,
    horario_chegada time NOT NULL,
    local_saida text,
    local_chegada text,
    distancia_km numeric(10, 2) NOT NULL DEFAULT 0 CHECK (distancia_km >= 0),
    CONSTRAINT horarios_operacao_trecho_unique
        UNIQUE (linha_id, tipo_dia_id, tabela, ida_volta, horario_saida)
);

CREATE INDEX IF NOT EXISTS horarios_operacao_linha_tipo_idx
    ON public.horarios_operacao (linha_id, tipo_dia_id, horario_saida);

ALTER TABLE public.horarios_operacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "horarios_operacao_select_allowed" ON public.horarios_operacao;
CREATE POLICY "horarios_operacao_select_allowed"
ON public.horarios_operacao FOR SELECT TO authenticated
USING (public.current_user_sector() IN ('Administração', 'Financeiro', 'Operacional', 'TI'));

REVOKE ALL ON public.tipos_dia, public.horarios_operacao FROM PUBLIC, anon;
GRANT SELECT ON public.tipos_dia, public.horarios_operacao TO authenticated;

-- 3) Vínculo do lançamento com o trecho ------------------------------------------------------
ALTER TABLE public.lancamentos
    ADD COLUMN IF NOT EXISTS horario_operacao_id bigint REFERENCES public.horarios_operacao(id);

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_horario_operacao_unique
    ON public.lancamentos (horario_operacao_id)
    WHERE horario_operacao_id IS NOT NULL;

-- 4) Regra de tipo de dia --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tipo_dia_por_data(p_data date)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE EXTRACT(DOW FROM p_data)
        WHEN 0 THEN 3::smallint  -- Domingo
        WHEN 6 THEN 2::smallint  -- Sábado
        ELSE 1::smallint         -- Segunda a sexta (Úteis)
    END;
$$;

REVOKE ALL ON FUNCTION public.tipo_dia_por_data(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tipo_dia_por_data(date) TO authenticated;

-- 5) Tarifas para o frontend (usadas no indicador R$ / km) -----------------------------------
CREATE OR REPLACE FUNCTION public.obter_tarifas_lancamento_publico()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'Operacional', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não pode consultar as tarifas.' USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'comum', valor_comum,
            'escolar', valor_escolar,
            'pagantes', valor_pagantes,
            'vt', valor_vt
        )
        FROM public.configuracao_tarifas_lancamentos
        WHERE id = 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_tarifas_lancamento_publico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_tarifas_lancamento_publico() TO authenticated;

-- 6) Gravação por viagem: agora vinculada ao trecho da grade ---------------------------------
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
    v_tipo_dia smallint;
    v_tarifas public.configuracao_tarifas_lancamentos%ROWTYPE;
    v_viagem jsonb;
    v_horario_operacao_id bigint;
    v_hora_inicio time;
    v_hora_fim time;
    v_km_grade numeric;
    v_quantidade_motorista integer;
    v_valor_garagem numeric;
    v_valor_excesso numeric;
    v_km_rodado numeric;
    v_valor_city numeric;
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

    v_tipo_dia := public.tipo_dia_por_data(p_data_op);

    SELECT * INTO v_tarifas
    FROM public.configuracao_tarifas_lancamentos
    WHERE id = 1;

    FOR v_viagem IN SELECT value FROM jsonb_array_elements(p_viagens)
    LOOP
        v_horario_operacao_id := nullif(v_viagem->>'horario_operacao_id', '')::bigint;
        IF v_horario_operacao_id IS NULL THEN
            RAISE EXCEPTION 'Uma viagem está sem vínculo com o trecho da grade.' USING ERRCODE = '22023';
        END IF;

        SELECT ho.horario_saida, ho.horario_chegada, ho.distancia_km
        INTO v_hora_inicio, v_hora_fim, v_km_grade
        FROM public.horarios_operacao ho
        WHERE ho.id = v_horario_operacao_id
          AND ho.linha_id = p_linha_id
          AND ho.tipo_dia_id = v_tipo_dia;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'O trecho informado não pertence à linha e ao tipo de dia da data selecionada.' USING ERRCODE = '22023';
        END IF;

        v_quantidade_motorista := coalesce(nullif(v_viagem->>'quantidade_motorista', '')::integer, 0);
        v_valor_excesso := coalesce(nullif(v_viagem->>'valor_excesso', '')::numeric, 0);
        v_km_rodado := coalesce(nullif(v_viagem->>'km_rodado', '')::numeric, v_km_grade);
        v_quantidade_comum := coalesce(nullif(v_viagem->>'quantidade_comum', '')::integer, 0);
        v_quantidade_escolar := coalesce(nullif(v_viagem->>'quantidade_escolar', '')::integer, 0);
        v_quantidade_pagantes := coalesce(nullif(v_viagem->>'quantidade_pagantes', '')::integer, 0);
        v_quantidade_vt := coalesce(nullif(v_viagem->>'quantidade_vt', '')::integer, 0);

        v_valor_garagem := v_quantidade_motorista * v_tarifas.valor_pagantes;

        v_valor_city := v_quantidade_comum * v_tarifas.valor_comum
            + v_quantidade_escolar * v_tarifas.valor_escolar
            + v_quantidade_vt * v_tarifas.valor_vt;

        IF v_quantidade_motorista < 0 OR v_valor_excesso < 0 OR v_km_rodado < 0
           OR v_quantidade_comum < 0 OR v_quantidade_escolar < 0
           OR v_quantidade_pagantes < 0 OR v_quantidade_vt < 0 THEN
            RAISE EXCEPTION 'Valores, quilometragem e quantidades não podem ser negativos.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.lancamentos (
            user_id, setor_id, data_op, linha_id, horario_operacao_id, hora_inicio, hora_fim,
            valor_garagem, quantidade_motorista, valor_city, valor_excesso, comum, escolar, pagantes, vt,
            quantidade_comum, quantidade_escolar, quantidade_pagantes, quantidade_vt, km_rodado
        ) VALUES (
            auth.uid(), public.current_user_sector_id(), p_data_op, p_linha_id, v_horario_operacao_id,
            v_hora_inicio, v_hora_fim, v_valor_garagem, v_quantidade_motorista, v_valor_city, v_valor_excesso,
            v_quantidade_comum * v_tarifas.valor_comum,
            v_quantidade_escolar * v_tarifas.valor_escolar,
            v_quantidade_pagantes * v_tarifas.valor_pagantes,
            v_quantidade_vt * v_tarifas.valor_vt,
            v_quantidade_comum, v_quantidade_escolar, v_quantidade_pagantes, v_quantidade_vt, v_km_rodado
        )
        ON CONFLICT (horario_operacao_id) WHERE horario_operacao_id IS NOT NULL
        DO UPDATE SET
            data_op = EXCLUDED.data_op,
            linha_id = EXCLUDED.linha_id,
            valor_garagem = EXCLUDED.valor_garagem,
            quantidade_motorista = EXCLUDED.quantidade_motorista,
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

-- 7) Listagem para o dashboard (inclui dados do trecho da grade) -----------------------------
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
            'horario_operacao_id', l.horario_operacao_id,
            'tabela', ho.tabela,
            'ida_volta', ho.ida_volta,
            'hora_inicio', l.hora_inicio,
            'hora_fim', l.hora_fim,
            'valor_excesso', l.valor_excesso,
            'km_rodado', l.km_rodado,
            'linhas', CASE WHEN li.id IS NULL THEN NULL ELSE jsonb_build_object('nome', li.nome) END
        )
        ELSE to_jsonb(l) || jsonb_build_object(
            'tabela', ho.tabela,
            'ida_volta', ho.ida_volta,
            'linhas', CASE WHEN li.id IS NULL THEN NULL ELSE jsonb_build_object('nome', li.nome) END
        )
    END
    FROM public.lancamentos l
    LEFT JOIN public.linhas li ON li.id = l.linha_id
    LEFT JOIN public.horarios_operacao ho ON ho.id = l.horario_operacao_id
    WHERE (p_linha_id IS NULL OR l.linha_id = p_linha_id)
      AND (p_data_inicio IS NULL OR l.data_op >= p_data_inicio)
      AND (p_data_fim IS NULL OR l.data_op <= p_data_fim)
    ORDER BY l.data_op DESC, l.hora_inicio ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_lancamentos_por_viagem(date, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_lancamentos_dashboard(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_lancamentos_por_viagem(date, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_lancamentos_dashboard(integer, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
