-- Folgas automáticas agrupadas por local e validação de disponibilidade.
-- Execute depois de escalas_substituto_fixo.sql.

ALTER TABLE public.escalas_operacionais
    ADD COLUMN IF NOT EXISTS local_base text;

ALTER TABLE public.escalas_trabalho
    ADD COLUMN IF NOT EXISTS escala_em_branco boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.validar_titular_escala_sem_sobreposicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_motorista_id uuid;
BEGIN
    IF NEW.motorista_substituto_fixo_id IS NOT NULL
       AND NEW.motorista_substituto_fixo_id = NEW.motorista_titular_id THEN
        RAISE EXCEPTION 'O substituto fixo deve ser diferente do motorista titular.';
    END IF;

    FOR v_motorista_id IN
        SELECT DISTINCT ids.motorista_id
        FROM unnest(ARRAY[
            NEW.motorista_titular_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.motorista_titular_id ELSE NULL END
        ]) AS ids(motorista_id)
        WHERE ids.motorista_id IS NOT NULL
        ORDER BY ids.motorista_id
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(v_motorista_id::text, 0));
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM public.escalas_operacionais eo
        WHERE eo.motorista_titular_id = NEW.motorista_titular_id
          AND eo.id IS DISTINCT FROM NEW.id
          AND (NEW.fim_vigencia IS NULL OR eo.inicio_vigencia <= NEW.fim_vigencia)
          AND (eo.fim_vigencia IS NULL OR NEW.inicio_vigencia <= eo.fim_vigencia)
    ) THEN
        RAISE EXCEPTION
            'Este motorista já está vinculado a outro código de escala com vigência sobreposta.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS escalas_operacionais_sem_titular_concorrente
    ON public.escalas_operacionais;
CREATE TRIGGER escalas_operacionais_sem_titular_concorrente
BEFORE INSERT OR UPDATE OF
    motorista_titular_id, motorista_substituto_fixo_id, inicio_vigencia, fim_vigencia
ON public.escalas_operacionais
FOR EACH ROW EXECUTE FUNCTION public.validar_titular_escala_sem_sobreposicao();

REVOKE ALL ON FUNCTION public.validar_titular_escala_sem_sobreposicao()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.motorista_disponivel_em_data(
    p_motorista_id uuid,
    p_data date,
    p_escala_operacional_id uuid,
    p_viagem_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_motorista_id IS NULL OR p_data IS NULL THEN
        RETURN false;
    END IF;

    -- Um motorista em folga na própria escala não pode cobrir outra escala.
    IF EXISTS (
        SELECT 1
        FROM public.escalas_operacionais eo
        WHERE eo.motorista_titular_id = p_motorista_id
          AND eo.id IS DISTINCT FROM p_escala_operacional_id
          AND p_data >= eo.inicio_vigencia
          AND (eo.fim_vigencia IS NULL OR p_data <= eo.fim_vigencia)
          AND public.escala_operacional_dia_eh_folga(eo.id, p_data)
    ) THEN
        RETURN false;
    END IF;

    -- Uma alocação em qualquer outra escala no mesmo dia torna o motorista indisponível.
    IF EXISTS (
        SELECT 1
        FROM public.escalas_trabalho e
        LEFT JOIN public.escalas_operacionais eo
            ON eo.id = e.escala_operacional_id
        LEFT JOIN public.substituicoes_escalas s
            ON s.escala_operacional_id = e.escala_operacional_id
           AND s.data_substituicao = e.data_escala
        WHERE e.data_escala = p_data
          AND e.id IS DISTINCT FROM p_viagem_id
          AND e.escala_operacional_id IS DISTINCT FROM p_escala_operacional_id
          AND CASE
              WHEN e.escala_em_branco THEN NULL::uuid
              WHEN eo.id IS NOT NULL
                   AND public.escala_operacional_dia_eh_folga(eo.id, e.data_escala)
                   AND coalesce(e.motorista_substituto_id, s.motorista_substituto_id) IS NULL
                  THEN NULL::uuid
              ELSE coalesce(e.motorista_substituto_id, s.motorista_substituto_id, e.motorista_id)
          END = p_motorista_id
    ) THEN
        RETURN false;
    END IF;

    -- Uma substituição cadastrada para outra escala reserva o motorista no dia.
    IF EXISTS (
        SELECT 1
        FROM public.substituicoes_escalas s
        JOIN public.escalas_operacionais eo ON eo.id = s.escala_operacional_id
        WHERE s.data_substituicao = p_data
          AND s.escala_operacional_id IS DISTINCT FROM p_escala_operacional_id
          AND s.motorista_substituto_id = p_motorista_id
          AND NOT public.escala_operacional_dia_eh_folga(eo.id, p_data)
    ) THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.motorista_disponivel_em_data(uuid, date, uuid, uuid)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_viagem_escala_titular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_titular_id uuid;
    v_substituto_fixo_id uuid;
    v_substituto_data_id uuid;
    v_motorista_alocado_id uuid;
    v_inicio date;
    v_fim date;
BEGIN
    NEW.escala_em_branco := false;

    IF NEW.escala_operacional_id IS NULL THEN
        IF NEW.motorista_substituto_id IS NOT NULL THEN
            RAISE EXCEPTION 'A substituição precisa estar vinculada a uma escala operacional.';
        END IF;
        PERFORM pg_advisory_xact_lock(
            hashtextextended(NEW.motorista_id::text || ':' || NEW.data_escala::text, 0)
        );
        IF NOT public.motorista_disponivel_em_data(
            NEW.motorista_id,
            NEW.data_escala,
            NULL,
            NEW.id
        ) THEN
            RAISE EXCEPTION
                'Este motorista está de folga ou alocado a outra escala nesta data.';
        END IF;
        RETURN NEW;
    END IF;

    SELECT eo.motorista_titular_id,
           eo.motorista_substituto_fixo_id,
           eo.inicio_vigencia,
           eo.fim_vigencia
    INTO v_titular_id, v_substituto_fixo_id, v_inicio, v_fim
    FROM public.escalas_operacionais eo
    WHERE eo.id = NEW.escala_operacional_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A escala operacional selecionada não existe.';
    END IF;

    IF NEW.motorista_id IS DISTINCT FROM v_titular_id THEN
        RAISE EXCEPTION 'A viagem vinculada deve manter o motorista titular da escala.';
    END IF;

    IF NEW.data_escala < v_inicio OR (v_fim IS NOT NULL AND NEW.data_escala > v_fim) THEN
        RAISE EXCEPTION 'A data da viagem deve estar dentro da vigência da escala.';
    END IF;

    SELECT s.motorista_substituto_id
    INTO v_substituto_data_id
    FROM public.substituicoes_escalas s
    WHERE s.escala_operacional_id = NEW.escala_operacional_id
      AND s.data_substituicao = NEW.data_escala;

    IF public.escala_operacional_dia_eh_folga(NEW.escala_operacional_id, NEW.data_escala) THEN
        v_motorista_alocado_id := v_substituto_fixo_id;

        IF v_motorista_alocado_id IS NULL OR v_motorista_alocado_id = v_titular_id THEN
            NEW.motorista_substituto_id := NULL;
            NEW.escala_em_branco := true;
            RETURN NEW;
        END IF;

        PERFORM pg_advisory_xact_lock(
            hashtextextended(v_motorista_alocado_id::text || ':' || NEW.data_escala::text, 0)
        );

        IF NOT public.motorista_disponivel_em_data(
            v_motorista_alocado_id,
            NEW.data_escala,
            NEW.escala_operacional_id,
            NEW.id
        ) THEN
            NEW.motorista_substituto_id := NULL;
            NEW.escala_em_branco := true;
            RETURN NEW;
        END IF;

        NEW.motorista_substituto_id := v_motorista_alocado_id;
        RETURN NEW;
    END IF;

    v_motorista_alocado_id := coalesce(v_substituto_data_id, v_titular_id);
    PERFORM pg_advisory_xact_lock(
        hashtextextended(v_motorista_alocado_id::text || ':' || NEW.data_escala::text, 0)
    );

    IF NOT public.motorista_disponivel_em_data(
        v_motorista_alocado_id,
        NEW.data_escala,
        NEW.escala_operacional_id,
        NEW.id
    ) THEN
        RAISE EXCEPTION
            'Este motorista já está alocado em outra escala ou está de folga nesta data.';
    END IF;

    NEW.motorista_substituto_id :=
        CASE WHEN v_motorista_alocado_id = v_titular_id THEN NULL ELSE v_motorista_alocado_id END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_viagem_escala_titular ON public.escalas_trabalho;
CREATE TRIGGER validar_viagem_escala_titular
BEFORE INSERT OR UPDATE OF
    escala_operacional_id, motorista_id, motorista_substituto_id, data_escala, escala_em_branco
ON public.escalas_trabalho
FOR EACH ROW EXECUTE FUNCTION public.validar_viagem_escala_titular();

REVOKE ALL ON FUNCTION public.validar_viagem_escala_titular()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_substituicao_escala()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_titular_id uuid;
    v_substituto_fixo_id uuid;
    v_inicio date;
    v_fim date;
BEGIN
    SELECT eo.motorista_titular_id,
           eo.motorista_substituto_fixo_id,
           eo.inicio_vigencia,
           eo.fim_vigencia
    INTO v_titular_id, v_substituto_fixo_id, v_inicio, v_fim
    FROM public.escalas_operacionais eo
    WHERE eo.id = NEW.escala_operacional_id;

    IF NOT FOUND OR NEW.data_substituicao < v_inicio
       OR (v_fim IS NOT NULL AND NEW.data_substituicao > v_fim) THEN
        RAISE EXCEPTION 'A substituição deve ocorrer durante a vigência da escala.';
    END IF;

    IF NEW.motorista_substituto_id = v_titular_id THEN
        RAISE EXCEPTION 'O substituto deve ser diferente do motorista titular.';
    END IF;

    IF public.escala_operacional_dia_eh_folga(NEW.escala_operacional_id, NEW.data_substituicao) THEN
        IF v_substituto_fixo_id IS NULL THEN
            RAISE EXCEPTION 'Configure o substituto fixo da escala para esta data de folga.';
        END IF;
        IF NEW.motorista_substituto_id IS DISTINCT FROM v_substituto_fixo_id THEN
            RAISE EXCEPTION 'Em dias de folga, deve ser usado o substituto fixo configurado para a escala.';
        END IF;
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.motorista_substituto_id::text || ':' || NEW.data_substituicao::text, 0)
    );

    IF NOT public.motorista_disponivel_em_data(
        NEW.motorista_substituto_id,
        NEW.data_substituicao,
        NEW.escala_operacional_id,
        NULL
    ) THEN
        RAISE EXCEPTION
            'O substituto já está em folga ou alocado a outra escala nesta data.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_substituicao_escala ON public.substituicoes_escalas;
CREATE TRIGGER validar_substituicao_escala
BEFORE INSERT OR UPDATE OF escala_operacional_id, data_substituicao, motorista_substituto_id
ON public.substituicoes_escalas
FOR EACH ROW EXECUTE FUNCTION public.validar_substituicao_escala();

REVOKE ALL ON FUNCTION public.validar_substituicao_escala()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sincronizar_viagem_substituicao_escala()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        UPDATE public.escalas_trabalho
        SET motorista_substituto_id = NULL
        WHERE escala_operacional_id = OLD.escala_operacional_id
          AND data_escala = OLD.data_substituicao;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        UPDATE public.escalas_trabalho
        SET motorista_substituto_id = NULL
        WHERE escala_operacional_id = NEW.escala_operacional_id
          AND data_escala = NEW.data_substituicao;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sincronizar_viagem_substituicao_escala
    ON public.substituicoes_escalas;
CREATE TRIGGER sincronizar_viagem_substituicao_escala
AFTER INSERT OR UPDATE OR DELETE ON public.substituicoes_escalas
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_viagem_substituicao_escala();

REVOKE ALL ON FUNCTION public.sincronizar_viagem_substituicao_escala()
    FROM PUBLIC, anon, authenticated;

-- Revalida as viagens sem sobrescrever substituições específicas de uma data.
CREATE OR REPLACE FUNCTION public.sincronizar_viagens_escala_operacional(
    p_escala_operacional_id uuid,
    p_data date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.escalas_trabalho
    SET motorista_substituto_id = NULL
    WHERE escala_operacional_id = p_escala_operacional_id
      AND (p_data IS NULL OR data_escala = p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_viagens_escala_operacional(uuid, date)
    FROM PUBLIC, anon, authenticated;

-- Reavalia viagens de folga existentes sem tocar nas viagens em dias normais.
UPDATE public.escalas_trabalho e
SET motorista_substituto_id = NULL
FROM public.escalas_operacionais eo
WHERE e.escala_operacional_id = eo.id
  AND public.escala_operacional_dia_eh_folga(eo.id, e.data_escala);

CREATE OR REPLACE FUNCTION public.listar_folgas_operacionais(p_data date)
RETURNS TABLE (
    data_escala date,
    escala_operacional_id uuid,
    codigo text,
    motorista_titular_id uuid,
    motorista_nome text,
    matricula text,
    local_base text,
    substituto_id uuid,
    substituto_nome text,
    substituto_disponivel boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Operacional', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não pode consultar as folgas operacionais.'
            USING ERRCODE = '42501';
    END IF;

    IF p_data IS NULL THEN
        RAISE EXCEPTION 'Informe a data para consultar as folgas.';
    END IF;

    RETURN QUERY
    SELECT
        p_data,
        eo.id,
        eo.codigo,
        titular.id,
        titular.nome::text,
        titular.matricula::text,
        eo.local_base,
        candidato.id,
        candidato.nome::text,
        CASE
            WHEN candidato.id IS NULL THEN false
            WHEN EXISTS (
                SELECT 1
                FROM public.escalas_trabalho e
                WHERE e.escala_operacional_id = eo.id
                  AND e.data_escala = p_data
                  AND e.escala_em_branco
            ) THEN false
            WHEN EXISTS (
                SELECT 1
                FROM public.escalas_trabalho e
                WHERE e.escala_operacional_id = eo.id
                  AND e.data_escala = p_data
                  AND e.motorista_substituto_id = candidato.id
                  AND NOT e.escala_em_branco
            ) THEN true
            ELSE public.motorista_disponivel_em_data(candidato.id, p_data, eo.id, NULL)
                 AND NOT EXISTS (
                    SELECT 1
                    FROM public.escalas_operacionais outra
                    WHERE outra.id <> eo.id
                      AND p_data >= outra.inicio_vigencia
                      AND (outra.fim_vigencia IS NULL OR p_data <= outra.fim_vigencia)
                      AND public.escala_operacional_dia_eh_folga(outra.id, p_data)
                      AND outra.motorista_substituto_fixo_id = candidato.id
                 )
        END
    FROM public.escalas_operacionais eo
    JOIN public.funcionarios titular ON titular.id = eo.motorista_titular_id
    LEFT JOIN public.funcionarios candidato
        ON candidato.id = eo.motorista_substituto_fixo_id
    WHERE p_data >= eo.inicio_vigencia
      AND (eo.fim_vigencia IS NULL OR p_data <= eo.fim_vigencia)
      AND public.escala_operacional_dia_eh_folga(eo.id, p_data)
    ORDER BY eo.local_base NULLS LAST, eo.codigo;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_folgas_operacionais(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_folgas_operacionais(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
