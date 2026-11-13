INSERT INTO public.setores (nome)
VALUES ('Motorista')
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE public.perfis
ADD COLUMN IF NOT EXISTS funcionario_id uuid
REFERENCES public.funcionarios (id)
ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS perfis_funcionario_id_unique
ON public.perfis (funcionario_id)
WHERE funcionario_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.minhas_escalas_motorista(
    p_data_inicio date DEFAULT CURRENT_DATE,
    p_data_fim date DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    data_escala date,
    linha_nome character varying,
    hora_inicio time without time zone,
    hora_fim time without time zone,
    numero_ordem text,
    modelo text,
    local_inicio text,
    local_final text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_funcionario_id uuid;
BEGIN
    IF public.current_user_sector() <> 'Motorista' THEN
        RAISE EXCEPTION 'Acesso exclusivo para o perfil Motorista.' USING ERRCODE = '42501';
    END IF;

    SELECT p.funcionario_id
    INTO v_funcionario_id
    FROM public.perfis p
    WHERE p.id = auth.uid();

    IF v_funcionario_id IS NULL THEN
        RAISE EXCEPTION 'Esta conta ainda não está vinculada a um motorista.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        e.id,
        e.data_escala,
        l.nome,
        e.hora_inicio,
        e.hora_fim,
        c.numero_ordem,
        c.modelo,
        e.local_inicio,
        e.local_final
    FROM public.escalas_trabalho e
    LEFT JOIN public.linhas l ON l.id = e.linha_id
    LEFT JOIN public.carros c ON c.id = e.carro_id
    WHERE e.motorista_id = v_funcionario_id
      AND (p_data_inicio IS NULL OR e.data_escala >= p_data_inicio)
      AND (p_data_fim IS NULL OR e.data_escala <= p_data_fim)
    ORDER BY e.data_escala, e.hora_inicio;
END;
$$;

REVOKE ALL ON FUNCTION public.minhas_escalas_motorista(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_escalas_motorista(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
