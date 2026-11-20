-- Controle Financeiro: coluna SIT calculada e novo Total
--
-- Regras:
--   SIT       = Comum + Escolar + VT (calculada; usada apenas no backend, para consultas futuras)
--   Motorista = valor_garagem (antigo "Garagem"; muda somente o rótulo na tela)
--   Total     = SIT + Motorista + Excesso
--
-- A antiga coluna "City" (valor_city) deixa de existir: a tela não digita mais esse valor e o
-- SIT passa a ser calculado. A coluna "pagantes" é mantida no histórico, porém a tela não a
-- digita mais e o valor deixa de entrar no total.
--
-- Execute depois de role_permissions.sql e lancamentos_por_viagem.sql.

-- 1) Recria o guarda de edição do Operacional sem depender de valor_city
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
           NEW.data_op, NEW.setor_id, NEW.valor_garagem, NEW.comum, NEW.escolar, NEW.pagantes, NEW.vt
       ) IS DISTINCT FROM ROW(
           OLD.data_op, OLD.setor_id, OLD.valor_garagem, OLD.comum, OLD.escolar, OLD.pagantes, OLD.vt
       ) THEN
        RAISE EXCEPTION 'Operacional só pode alterar linha, excesso e km rodado.';
    END IF;

    RETURN NEW;
END;
$$;

-- 2) Gravação legada (um lançamento por linha/data) sem valor_city
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
            user_id, setor_id, data_op, linha_id, valor_garagem,
            valor_excesso, comum, escolar, pagantes, vt, km_rodado
        ) VALUES (
            auth.uid(), public.current_user_sector_id(),
            (p_dados->>'data_op')::date, v_linha_id,
            coalesce(nullif(p_dados->>'valor_garagem', '')::numeric, 0),
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

-- 3) Gravação por viagem sem valor_city
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
        v_valor_excesso := coalesce(nullif(v_viagem->>'valor_excesso', '')::numeric, 0);
        v_km_rodado := coalesce(nullif(v_viagem->>'km_rodado', '')::numeric, 0);
        v_quantidade_comum := coalesce(nullif(v_viagem->>'quantidade_comum', '')::integer, 0);
        v_quantidade_escolar := coalesce(nullif(v_viagem->>'quantidade_escolar', '')::integer, 0);
        v_quantidade_pagantes := coalesce(nullif(v_viagem->>'quantidade_pagantes', '')::integer, 0);
        v_quantidade_vt := coalesce(nullif(v_viagem->>'quantidade_vt', '')::integer, 0);

        IF v_valor_garagem < 0 OR v_valor_excesso < 0 OR v_km_rodado < 0
           OR v_quantidade_comum < 0 OR v_quantidade_escolar < 0
           OR v_quantidade_pagantes < 0 OR v_quantidade_vt < 0 THEN
            RAISE EXCEPTION 'Valores, quilometragem e quantidades não podem ser negativos.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.lancamentos (
            user_id, setor_id, data_op, linha_id, escala_id, hora_inicio, hora_fim,
            valor_garagem, valor_excesso, comum, escolar, pagantes, vt,
            quantidade_comum, quantidade_escolar, quantidade_pagantes, quantidade_vt, km_rodado
        ) VALUES (
            auth.uid(), public.current_user_sector_id(), p_data_op, p_linha_id, v_escala_id,
            v_hora_inicio, v_hora_fim, v_valor_garagem, v_valor_excesso,
            v_quantidade_comum * v_tarifas.valor_comum,
            v_quantidade_escolar * v_tarifas.valor_escolar,
            v_quantidade_pagantes * v_tarifas.valor_pagantes,
            v_quantidade_vt * v_tarifas.valor_vt,
            v_quantidade_comum, v_quantidade_escolar, v_quantidade_pagantes, v_quantidade_vt, v_km_rodado
        )
        ON CONFLICT (escala_id) WHERE escala_id IS NOT NULL
        DO UPDATE SET
            valor_garagem = EXCLUDED.valor_garagem,
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

-- 4) Ajusta as colunas do lançamento
--    valor_total depende de valor_city, por isso é removido antes; ambos são recriados/removidos
--    com segurança (IF EXISTS / IF NOT EXISTS) para permitir reexecução.
ALTER TABLE public.lancamentos DROP COLUMN IF EXISTS valor_total;
ALTER TABLE public.lancamentos DROP COLUMN IF EXISTS valor_city;

ALTER TABLE public.lancamentos
    ADD COLUMN IF NOT EXISTS valor_sit numeric(10, 2)
    GENERATED ALWAYS AS (
        round(coalesce(comum, 0) + coalesce(escolar, 0) + coalesce(vt, 0), 2)
    ) STORED;

ALTER TABLE public.lancamentos
    ADD COLUMN IF NOT EXISTS valor_total numeric(12, 2)
    GENERATED ALWAYS AS (
        round(
            coalesce(comum, 0) + coalesce(escolar, 0) + coalesce(vt, 0)
            + coalesce(valor_garagem, 0) + coalesce(valor_excesso, 0),
            2
        )
    ) STORED;

NOTIFY pgrst, 'reload schema';
