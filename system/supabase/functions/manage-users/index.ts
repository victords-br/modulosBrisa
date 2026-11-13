import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return respond({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Edge Function.");
    return respond({ error: "Serviço de administração não configurado." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return respond({ error: "Sessão obrigatória." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return respond({ error: "Sessão inválida ou expirada." }, 401);
  }

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("perfis")
    .select("id, nome, setores!inner(nome)")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (callerProfileError || !callerProfile || callerProfile.setores.nome !== "TI") {
    return respond({ error: "Acesso permitido somente ao setor de TI." }, 403);
  }

  async function auditUserChange(action: string, userId: string, oldData: unknown, newData: unknown) {
    const { error } = await admin.from("audit_logs").insert({
      actor_id: authData.user.id,
      actor_name: callerProfile.nome || authData.user.user_metadata?.full_name || authData.user.email,
      actor_email: authData.user.email,
      action,
      entity: "usuarios",
      entity_id: userId,
      old_data: oldData,
      new_data: newData,
    });
    if (error) throw error;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  const action = body.action;

  try {
    if (action === "list") {
      const users: Array<Record<string, unknown>> = [];
      let page = 1;
      const perPage = 1000;

      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < perPage) break;
        page += 1;
      }

      const { data: profiles, error: profilesError } = await admin
        .from("perfis")
        .select("id, nome, setor_id, funcionario_id, setores(nome), funcionarios(nome, matricula)");
      if (profilesError) throw profilesError;

      const { data: sectorRows, error: sectorsError } = await admin
        .from("setores")
        .select("id, nome")
        .order("nome");
      if (sectorsError) throw sectorsError;

      const { data: driverRows, error: driversError } = await admin
        .from("funcionarios")
        .select("id, nome, matricula")
        .order("nome");
      if (driversError) throw driversError;

      const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
      const result = users.map(user => {
        const profile = profilesById.get(user.id);
        return {
          id: user.id,
          name: profile?.nome || user.user_metadata?.full_name || "",
          email: user.email || "",
          sector_id: profile?.setor_id || null,
          sector: profile?.setores?.nome || null,
          funcionario_id: profile?.funcionario_id || null,
          driver: profile?.funcionarios ? `${profile.funcionarios.nome} (${profile.funcionarios.matricula})` : null,
          email_confirmed: Boolean(user.email_confirmed_at),
          created_at: user.created_at,
        };
      }).sort((left, right) => String(left.name || left.email).localeCompare(String(right.name || right.email), "pt-BR"));

      return respond({
        users: result,
        sectors: (sectorRows || []).map(sector => ({ id: sector.id, name: sector.nome })),
        drivers: (driverRows || []).map(driver => ({ id: driver.id, name: driver.nome, matricula: driver.matricula })),
      });
    }

    if (action === "create") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const sectorId = Number(body.sector_id);
      if (!name || !email || password.length < 8 || !Number.isInteger(sectorId)) {
        return respond({ error: "Informe nome, e-mail, setor e senha com pelo menos 8 caracteres." }, 400);
      }

      const { data: sector, error: sectorError } = await admin.from("setores").select("id").eq("id", sectorId).maybeSingle();
      if (sectorError || !sector) return respond({ error: "Setor inválido." }, 400);

      const { data: sectorDetails, error: sectorDetailsError } = await admin.from("setores").select("nome").eq("id", sectorId).single();
      if (sectorDetailsError) throw sectorDetailsError;
      const funcionarioId = body.funcionario_id ? String(body.funcionario_id) : null;
      if (sectorDetails.nome === "Motorista" && !funcionarioId) {
        return respond({ error: "Vincule a conta a um funcionário motorista." }, 400);
      }
      if (funcionarioId) {
        const { data: funcionario, error: funcionarioError } = await admin.from("funcionarios").select("id").eq("id", funcionarioId).maybeSingle();
        if (funcionarioError || !funcionario) return respond({ error: "Motorista vinculado não encontrado." }, 400);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: body.email_confirmed === true,
        user_metadata: { full_name: name },
      });
      if (createError) return respond({ error: createError.message }, 400);

      const { error: profileError } = await admin.from("perfis").upsert({
        id: created.user.id,
        nome: name,
        setor_id: sectorId,
        funcionario_id: sectorDetails.nome === "Motorista" ? funcionarioId : null,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      await auditUserChange("create", created.user.id, null, {
        name,
        email,
        sector_id: sectorId,
        funcionario_id: sectorDetails.nome === "Motorista" ? funcionarioId : null,
        email_confirmed: body.email_confirmed === true,
      });

      return respond({ id: created.user.id }, 201);
    }

    if (action === "update") {
      const userId = String(body.user_id || "");
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const sectorId = Number(body.sector_id);
      const password = body.password === undefined ? "" : String(body.password);
      if (!userId || !name || !email || !Number.isInteger(sectorId) || (password && password.length < 8)) {
        return respond({ error: "Dados inválidos. Senhas novas devem ter pelo menos 8 caracteres." }, 400);
      }

      const { data: sector, error: sectorError } = await admin.from("setores").select("id, nome").eq("id", sectorId).maybeSingle();
      if (sectorError || !sector) return respond({ error: "Setor inválido." }, 400);

      const funcionarioId = body.funcionario_id ? String(body.funcionario_id) : null;
      if (sector.nome === "Motorista" && !funcionarioId) {
        return respond({ error: "Vincule a conta a um funcionário motorista." }, 400);
      }
      if (funcionarioId) {
        const { data: funcionario, error: funcionarioError } = await admin.from("funcionarios").select("id").eq("id", funcionarioId).maybeSingle();
        if (funcionarioError || !funcionario) return respond({ error: "Motorista vinculado não encontrado." }, 400);
      }

      const { data: previousProfile, error: previousProfileError } = await admin
        .from("perfis")
        .select("id, nome, setor_id, funcionario_id")
        .eq("id", userId)
        .maybeSingle();
      if (previousProfileError) throw previousProfileError;

      const { data: previousAuth, error: previousAuthError } = await admin.auth.admin.getUserById(userId);
      if (previousAuthError || !previousAuth.user) {
        return respond({ error: "Usuário não encontrado." }, 404);
      }

        const { data: tiSector, error: tiSectorError } = await admin
          .from("setores")
          .select("id")
          .eq("nome", "TI")
          .single();
        if (tiSectorError) throw tiSectorError;

        if (previousProfile?.setor_id === tiSector.id && sectorId !== tiSector.id) {
          const { count, error: countError } = await admin
            .from("perfis")
            .select("id", { count: "exact", head: true })
            .eq("setor_id", tiSector.id);
          if (countError) throw countError;
          if ((count || 0) <= 1) return respond({ error: "Não é permitido rebaixar o último usuário do setor TI." }, 409);
        }

      const { error: profileError } = await admin.from("perfis").upsert({
        id: userId,
        nome: name,
        setor_id: sectorId,
        funcionario_id: sector.nome === "Motorista" ? funcionarioId : null,
      });
      if (profileError) throw profileError;

      const authUpdates: Record<string, unknown> = {
        email,
        email_confirm: body.email_confirmed === true,
        user_metadata: { full_name: name },
      };
      if (password) authUpdates.password = password;
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, authUpdates);
      if (updateError) {
        if (previousProfile) await admin.from("perfis").update(previousProfile).eq("id", userId);
        else await admin.from("perfis").delete().eq("id", userId);
        return respond({ error: updateError.message }, 400);
      }

      await auditUserChange("update", userId, {
        name: previousProfile?.nome || previousAuth.user.user_metadata?.full_name || "",
        email: previousAuth.user.email || "",
        sector_id: previousProfile?.setor_id || null,
        funcionario_id: previousProfile?.funcionario_id || null,
        email_confirmed: Boolean(previousAuth.user.email_confirmed_at),
      }, {
        name,
        email,
        sector_id: sectorId,
        funcionario_id: sector.nome === "Motorista" ? funcionarioId : null,
        email_confirmed: body.email_confirmed === true,
      });

      return respond({ id: userId });
    }

    if (action === "delete") {
      const userId = String(body.user_id || "");
      if (!userId) return respond({ error: "Usuário inválido." }, 400);
      if (userId === authData.user.id) return respond({ error: "Não é permitido excluir a própria conta de TI." }, 400);

      const { data: targetProfile, error: targetError } = await admin
        .from("perfis")
        .select("id, setor_id, funcionario_id, setores(nome)")
        .eq("id", userId)
        .maybeSingle();
      if (targetError) throw targetError;

      const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(userId);
      if (targetAuthError || !targetAuth.user) {
        return respond({ error: "Usuário não encontrado." }, 404);
      }

      if (targetProfile?.setores?.nome === "TI") {
        const { count, error: countError } = await admin
          .from("perfis")
          .select("id", { count: "exact", head: true })
          .eq("setor_id", targetProfile.setor_id);
        if (countError) throw countError;
        if ((count || 0) <= 1) return respond({ error: "Não é permitido excluir o último usuário do setor TI." }, 409);
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) return respond({ error: deleteError.message }, 400);

      await auditUserChange("delete", userId, {
        name: targetProfile?.id ? targetAuth.user.user_metadata?.full_name || "" : "",
        email: targetAuth.user.email || "",
        sector_id: targetProfile?.sector_id || null,
        funcionario_id: targetProfile?.funcionario_id || null,
        sector: targetProfile?.setores?.nome || null,
        email_confirmed: Boolean(targetAuth.user.email_confirmed_at),
      }, null);

      return respond({ id: userId });
    }

    return respond({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("manage-users failed:", error);
    return respond({ error: error instanceof Error ? error.message : "Erro interno ao administrar usuários." }, 500);
  }
});
