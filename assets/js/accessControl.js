window.modulePermissions = {
    checklist: ['Administração', 'TI'],
    financeiro: ['Administração', 'Financeiro', 'Operacional', 'TI'],
    combustivel: ['Administração', 'TI'],
    portaria: ['Administração', 'TI'],
    os: ['Administração', 'TI'],
    escala: ['Administração', 'Operacional', 'TI'],
    usuarios: ['TI'],
    auditoria: ['TI'],
    motorista: ['Motorista']
};

window.getCurrentAppContext = async function() {
    const { data: { session }, error: sessionError } = await window.supabaseClient.auth.getSession();

    if (sessionError || !session) {
        return { session: null, profile: null, error: sessionError };
    }

    const { data: profile, error } = await window.supabaseClient
        .from('perfis')
        .select('id, nome, setor_id, setores(nome)')
        .eq('id', session.user.id)
        .maybeSingle();

    return {
        session,
        profile,
        sector: profile && profile.setores ? profile.setores.nome : null,
        error
    };
};

window.requireModuleAccess = async function(moduleName) {
    const context = await window.getCurrentAppContext();

    if (!context.session) {
        window.location.replace('login.html');
        return null;
    }

    const allowedSectors = window.modulePermissions[moduleName] || [];
    if (!context.profile || !allowedSectors.includes(context.sector)) {
        window.alert(context.profile ? 'Seu setor não tem acesso a este módulo.' : 'Seu usuário não possui perfil de acesso cadastrado.');
        window.location.replace('index.html');
        return null;
    }

    return context;
};
