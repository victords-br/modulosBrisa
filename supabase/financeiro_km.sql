-- Controle Financeiro: indicador de R$ / km
--
-- Expõe somente a tarifa de VT (valor da passagem) para os setores que enxergam o total no
-- dashboard (Administração, Financeiro e TI). A tela usa esse valor para colorir a coluna
-- "R$ / km": vermelho quando o R$ / km fica abaixo da tarifa de VT e verde quando é igual ou maior.
--
-- A tarifa continua sendo configurada apenas no módulo TI (configuracao_tarifas_lancamentos).
-- Execute depois de lancamentos_por_viagem.sql.

CREATE OR REPLACE FUNCTION public.obter_tarifa_vt_lancamento()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setor text := public.current_user_sector();
BEGIN
    IF coalesce(v_setor, '') NOT IN ('Administração', 'Financeiro', 'TI') THEN
        RAISE EXCEPTION 'Seu setor não pode consultar a tarifa de VT.' USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT valor_vt
        FROM public.configuracao_tarifas_lancamentos
        WHERE id = 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_tarifa_vt_lancamento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_tarifa_vt_lancamento() TO authenticated;

NOTIFY pgrst, 'reload schema';
