-- Substituto fixo para folgas de escalas operacionais.
-- Execute depois de escalas_operacionais.sql.

ALTER TABLE public.escalas_operacionais
    ADD COLUMN IF NOT EXISTS motorista_substituto_fixo_id uuid
        REFERENCES public.funcionarios (id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.escala_operacional_dia_eh_folga(
    p_escala_operacional_id uuid,
    p_data date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inicio date;
    v_fim date;
    v_padrao text;
    v_tipo_excecao text;
BEGIN
    SELECT eo.inicio_vigencia, eo.fim_vigencia, rf.padrao_ciclo
    INTO v_inicio, v_fim, v_padrao
    FROM public.escalas_operacionais eo
    LEFT JOIN public.regras_folga_escalas rf ON rf.id = eo.regra_folga_id
    WHERE eo.id = p_escala_operacional_id;

    IF NOT FOUND OR p_data IS NULL OR p_data < v_inicio
       OR (v_fim IS NOT NULL AND p_data > v_fim) THEN
        RETURN false;
    END IF;

    SELECT f.tipo
    INTO v_tipo_excecao
    FROM public.folgas_escalas f
    WHERE f.escala_operacional_id = p_escala_operacional_id
      AND f.data_folga = p_data;

    IF FOUND THEN
        RETURN v_tipo_excecao = 'folga';
    END IF;

    IF coalesce(v_padrao, '') = '' THEN
        RETURN false;
    END IF;

    RETURN substring(
        v_padrao
        FROM ((p_data - v_inicio) % length(v_padrao)) + 1
        FOR 1
    ) = 'F';
END;
$$;

REVOKE ALL ON FUNCTION public.escala_operacional_dia_eh_folga(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_viagem_escala_titular()
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
    IF NEW.escala_operacional_id IS NULL THEN
        IF NEW.motorista_substituto_id IS NOT NULL THEN
            RAISE EXCEPTION 'A substituição precisa estar vinculada a uma escala operacional.';
        END IF;
        RETURN NEW;
    END IF;

    SELECT motorista_titular_id, motorista_substituto_fixo_id, inicio_vigencia, fim_vigencia
    INTO v_titular_id, v_substituto_fixo_id, v_inicio, v_fim
    FROM public.escalas_operacionais
    WHERE id = NEW.escala_operacional_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A escala operacional selecionada não existe.';
    END IF;

    IF NEW.motorista_id IS DISTINCT FROM v_titular_id THEN
        RAISE EXCEPTION 'A viagem vinculada deve manter o motorista titular da escala.';
    END IF;

    IF NEW.data_escala < v_inicio OR (v_fim IS NOT NULL AND NEW.data_escala > v_fim) THEN
        RAISE EXCEPTION 'A data da viagem deve estar dentro da vigência da escala.';
    END IF;

    IF public.escala_operacional_dia_eh_folga(NEW.escala_operacional_id, NEW.data_escala) THEN
        IF v_substituto_fixo_id IS NULL THEN
            RAISE EXCEPTION 'Esta data é uma folga. Configure um substituto fixo na escala operacional antes de criar a viagem.';
        END IF;
        IF v_substituto_fixo_id = v_titular_id THEN
            RAISE EXCEPTION 'O substituto fixo deve ser diferente do motorista titular.';
        END IF;
        NEW.motorista_substituto_id := v_substituto_fixo_id;
        RETURN NEW;
    END IF;

    -- Substituições em dias trabalhados continuam sendo controladas pela tabela por data.
    NEW.motorista_substituto_id := NULL;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_viagem_escala_titular ON public.escalas_trabalho;
CREATE TRIGGER validar_viagem_escala_titular
BEFORE INSERT OR UPDATE OF escala_operacional_id, motorista_id, motorista_substituto_id, data_escala
ON public.escalas_trabalho
FOR EACH ROW EXECUTE FUNCTION public.validar_viagem_escala_titular();
REVOKE ALL ON FUNCTION public.validar_viagem_escala_titular() FROM PUBLIC, anon, authenticated;

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
    SELECT motorista_titular_id, motorista_substituto_fixo_id, inicio_vigencia, fim_vigencia
    INTO v_titular_id, v_substituto_fixo_id, v_inicio, v_fim
    FROM public.escalas_operacionais
    WHERE id = NEW.escala_operacional_id;

    IF NOT FOUND OR NEW.data_substituicao < v_inicio
       OR (v_fim IS NOT NULL AND NEW.data_substituicao > v_fim) THEN
        RAISE EXCEPTION 'A substituição deve ocorrer durante a vigência da escala.';
    END IF;

    IF NEW.motorista_substituto_id = v_titular_id THEN
        RAISE EXCEPTION 'O substituto deve ser diferente do motorista titular.';
    END IF;

    IF public.escala_operacional_dia_eh_folga(NEW.escala_operacional_id, NEW.data_substituicao) THEN
        IF v_substituto_fixo_id IS NULL THEN
            RAISE EXCEPTION 'Esta data é uma folga. Configure o substituto fixo na escala operacional.';
        END IF;
        IF NEW.motorista_substituto_id IS DISTINCT FROM v_substituto_fixo_id THEN
            RAISE EXCEPTION 'Nesta folga deve ser usado o substituto fixo configurado para a escala.';
        END IF;
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

CREATE OR REPLACE FUNCTION public.validar_substituto_fixo_escala()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.motorista_substituto_fixo_id IS NOT NULL
       AND NEW.motorista_substituto_fixo_id = NEW.motorista_titular_id THEN
        RAISE EXCEPTION 'O substituto fixo deve ser diferente do motorista titular.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_substituto_fixo_escala ON public.escalas_operacionais;
CREATE TRIGGER validar_substituto_fixo_escala
BEFORE INSERT OR UPDATE OF motorista_titular_id, motorista_substituto_fixo_id
ON public.escalas_operacionais
FOR EACH ROW EXECUTE FUNCTION public.validar_substituto_fixo_escala();
REVOKE ALL ON FUNCTION public.validar_substituto_fixo_escala() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sincronizar_viagens_escala_operacional(
    p_escala_operacional_id uuid,
    p_data date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_substituto_fixo_id uuid;
BEGIN
    SELECT motorista_substituto_fixo_id
    INTO v_substituto_fixo_id
    FROM public.escalas_operacionais
    WHERE id = p_escala_operacional_id;

    IF v_substituto_fixo_id IS NULL AND EXISTS (
        SELECT 1
        FROM public.substituicoes_escalas s
        WHERE s.escala_operacional_id = p_escala_operacional_id
          AND (p_data IS NULL OR s.data_substituicao = p_data)
          AND public.escala_operacional_dia_eh_folga(s.escala_operacional_id, s.data_substituicao)
    ) THEN
        RAISE EXCEPTION 'Configure um substituto fixo antes de marcar como folga uma data com substituição cadastrada.';
    END IF;

    IF v_substituto_fixo_id IS NOT NULL THEN
        UPDATE public.substituicoes_escalas s
        SET motorista_substituto_id = v_substituto_fixo_id
        WHERE s.escala_operacional_id = p_escala_operacional_id
          AND (p_data IS NULL OR s.data_substituicao = p_data)
          AND public.escala_operacional_dia_eh_folga(s.escala_operacional_id, s.data_substituicao)
          AND s.motorista_substituto_id IS DISTINCT FROM v_substituto_fixo_id;
    END IF;

    UPDATE public.escalas_trabalho
    SET motorista_substituto_id = NULL
    WHERE escala_operacional_id = p_escala_operacional_id
      AND (p_data IS NULL OR data_escala = p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_viagens_escala_operacional(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sincronizar_regras_escala_operacional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_escala_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'escalas_operacionais' THEN
        PERFORM public.sincronizar_viagens_escala_operacional(NEW.id);
    ELSE
        FOR v_escala_id IN
            SELECT eo.id
            FROM public.escalas_operacionais eo
            WHERE eo.regra_folga_id = NEW.id
        LOOP
            PERFORM public.sincronizar_viagens_escala_operacional(v_escala_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sincronizar_viagens_escala_operacional ON public.escalas_operacionais;
CREATE TRIGGER sincronizar_viagens_escala_operacional
AFTER UPDATE OF motorista_substituto_fixo_id, regra_folga_id, inicio_vigencia, fim_vigencia
ON public.escalas_operacionais
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_regras_escala_operacional();

DROP TRIGGER IF EXISTS sincronizar_viagens_regra_folga ON public.regras_folga_escalas;
CREATE TRIGGER sincronizar_viagens_regra_folga
AFTER UPDATE OF padrao_ciclo
ON public.regras_folga_escalas
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_regras_escala_operacional();
REVOKE ALL ON FUNCTION public.sincronizar_regras_escala_operacional() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sincronizar_excecao_folga_escala()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.sincronizar_viagens_escala_operacional(OLD.escala_operacional_id, OLD.data_folga);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND (OLD.escala_operacional_id, OLD.data_folga)
           IS DISTINCT FROM (NEW.escala_operacional_id, NEW.data_folga) THEN
        PERFORM public.sincronizar_viagens_escala_operacional(OLD.escala_operacional_id, OLD.data_folga);
    END IF;
    PERFORM public.sincronizar_viagens_escala_operacional(NEW.escala_operacional_id, NEW.data_folga);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sincronizar_excecao_folga_escala ON public.folgas_escalas;
CREATE TRIGGER sincronizar_excecao_folga_escala
AFTER INSERT OR UPDATE OR DELETE
ON public.folgas_escalas
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_excecao_folga_escala();
REVOKE ALL ON FUNCTION public.sincronizar_excecao_folga_escala() FROM PUBLIC, anon, authenticated;

-- Aplica o substituto fixo às viagens já cadastradas em folgas quando a escala já o possui.
UPDATE public.escalas_trabalho e
SET motorista_substituto_id = eo.motorista_substituto_fixo_id
FROM public.escalas_operacionais eo
WHERE eo.id = e.escala_operacional_id
  AND eo.motorista_substituto_fixo_id IS NOT NULL
  AND public.escala_operacional_dia_eh_folga(e.escala_operacional_id, e.data_escala)
  AND e.motorista_substituto_id IS DISTINCT FROM eo.motorista_substituto_fixo_id;

NOTIFY pgrst, 'reload schema';
