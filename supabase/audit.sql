CREATE TABLE IF NOT EXISTS public.audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_id uuid,
    actor_name text,
    actor_email text,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    old_data jsonb,
    new_data jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx
    ON public.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
    ON public.audit_logs (entity, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
    ON public.audit_logs (actor_id, occurred_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_select_ti" ON public.audit_logs;
CREATE POLICY "audit_logs_select_ti"
ON public.audit_logs FOR SELECT TO authenticated
USING (public.current_user_sector() = 'TI');

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT INSERT ON TABLE public.audit_logs TO service_role;

CREATE OR REPLACE FUNCTION public.audit_operational_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_name text;
    v_actor_email text;
    v_old_data jsonb;
    v_new_data jsonb;
    v_entity_id text;
BEGIN
    IF v_actor_id IS NOT NULL THEN
        SELECT p.nome, u.email
        INTO v_actor_name, v_actor_email
        FROM auth.users u
        LEFT JOIN public.perfis p ON p.id = u.id
        WHERE u.id = v_actor_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_new_data := to_jsonb(NEW);
        v_entity_id := v_new_data->>'id';
    ELSIF TG_OP = 'UPDATE' THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        v_entity_id := v_new_data->>'id';
    ELSE
        v_old_data := to_jsonb(OLD);
        v_entity_id := v_old_data->>'id';
    END IF;

    INSERT INTO public.audit_logs (
        actor_id, actor_name, actor_email, action, entity, entity_id, old_data, new_data
    ) VALUES (
        v_actor_id, v_actor_name, v_actor_email, lower(TG_OP), TG_TABLE_NAME,
        v_entity_id, v_old_data, v_new_data
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_operational_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_lancamentos_changes ON public.lancamentos;
CREATE TRIGGER audit_lancamentos_changes
AFTER INSERT OR UPDATE OR DELETE ON public.lancamentos
FOR EACH ROW EXECUTE FUNCTION public.audit_operational_change();

DROP TRIGGER IF EXISTS audit_escalas_changes ON public.escalas_trabalho;
CREATE TRIGGER audit_escalas_changes
AFTER INSERT OR UPDATE OR DELETE ON public.escalas_trabalho
FOR EACH ROW EXECUTE FUNCTION public.audit_operational_change();

NOTIFY pgrst, 'reload schema';
