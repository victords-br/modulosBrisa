document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient || !window.getCurrentAppContext) {
        console.error('Supabase ou controle de acesso não foi inicializado.');
        return;
    }

    const context = await window.getCurrentAppContext();
    if (!context.session) {
        window.location.replace('login.html');
        return;
    }

    if (!context.profile || !context.sector) {
        window.alert('Seu usuário não possui perfil de acesso cadastrado.');
        await window.logout();
        return;
    }

    if (context.sector === 'Motorista') {
        window.location.replace('motorista.html');
        return;
    }

    const infoPortal = document.getElementById('infoPortal');
    if (infoPortal) {
        infoPortal.textContent = `${context.profile.nome || context.session.user.email} - ${context.sector}`;
    }

    let totalModulos = 0;
    document.querySelectorAll('.system-card[data-module]').forEach(card => {
        const moduleName = card.dataset.module;
        const allowedSectors = window.modulePermissions[moduleName] || [];
        const hasAccess = allowedSectors.includes(context.sector);
        card.closest('[data-module-card]').hidden = !hasAccess;
        if (hasAccess) {
            totalModulos += 1;
        }
    });

    const aviso = document.getElementById('portalAviso');
    if (aviso && totalModulos === 0) {
        aviso.textContent = 'Nenhum módulo está liberado para o seu setor.';
        aviso.hidden = false;
    }

    document.body.classList.remove('portal-loading');
});
