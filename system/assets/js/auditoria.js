document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient || !window.requireModuleAccess) {
        console.error('Supabase ou controle de acesso não foi inicializado.');
        return;
    }

    const context = await window.requireModuleAccess('auditoria');
    if (!context) return;

    const rowsBody = document.getElementById('corpoAuditoria');
    const countLabel = document.getElementById('contadorAuditoria');
    const message = document.getElementById('mensagemAuditoria');
    const searchInput = document.getElementById('buscaAuditoria');
    let events = [];

    document.getElementById('infoUsuario').textContent = `${context.profile.nome || context.session.user.email} - ${context.sector}`;
    document.getElementById('btnLogout').addEventListener('click', window.logout);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function labelAction(action) {
        return ({ insert: 'Criação', create: 'Criação', update: 'Edição', delete: 'Exclusão' })[action] || action;
    }

    function labelEntity(entity) {
        return ({ usuarios: 'Usuários', lancamentos: 'Lançamentos', escalas_trabalho: 'Escalas' })[entity] || entity;
    }

    function showError(text) {
        message.textContent = text;
        message.className = 'alert alert-danger';
        message.classList.remove('d-none');
    }

    function renderEvents() {
        const term = searchInput.value.trim().toLocaleLowerCase('pt-BR');
        const filtered = events.filter(event => {
            const searchable = `${event.actor_name || ''} ${event.actor_email || ''} ${event.entity_id || ''}`.toLocaleLowerCase('pt-BR');
            return !term || searchable.includes(term);
        });

        countLabel.textContent = `${filtered.length} eventos${events.length === 500 ? ' (máximo de 500 carregados)' : ''}`;
        if (filtered.length === 0) {
            rowsBody.innerHTML = '<tr><td class="text-center text-muted py-4" colspan="6">Nenhum evento encontrado.</td></tr>';
            return;
        }

        rowsBody.innerHTML = filtered.map(event => {
            const date = new Date(event.occurred_at).toLocaleString('pt-BR');
            const actor = event.actor_name || event.actor_email || event.actor_id || 'Sistema';
            const details = JSON.stringify({ antes: event.old_data, depois: event.new_data }, null, 2);
            return `<tr>
                <td class="text-nowrap">${escapeHtml(date)}</td>
                <td>${escapeHtml(actor)}${event.actor_email && event.actor_name ? `<div class="small text-muted">${escapeHtml(event.actor_email)}</div>` : ''}</td>
                <td>${escapeHtml(labelAction(event.action))}</td>
                <td>${escapeHtml(labelEntity(event.entity))}</td>
                <td class="text-break"><code>${escapeHtml(event.entity_id || '-')}</code></td>
                <td><details><summary>Ver</summary><pre class="small text-wrap mt-2 mb-0">${escapeHtml(details)}</pre></details></td>
            </tr>`;
        }).join('');
    }

    async function loadEvents() {
        rowsBody.innerHTML = '<tr><td class="text-center text-muted py-4" colspan="6">Carregando eventos...</td></tr>';
        message.classList.add('d-none');

        let query = window.supabaseClient
            .from('audit_logs')
            .select('id, occurred_at, actor_id, actor_name, actor_email, action, entity, entity_id, old_data, new_data')
            .order('occurred_at', { ascending: false })
            .limit(500);

        const entity = document.getElementById('filtroEntidade').value;
        const action = document.getElementById('filtroAcao').value;
        const startDate = document.getElementById('filtroDataInicio').value;
        const endDate = document.getElementById('filtroDataFim').value;

        if (entity) query = query.eq('entity', entity);
        if (action) query = query.eq('action', action);
        if (startDate) query = query.gte('occurred_at', `${startDate}T00:00:00`);
        if (endDate) query = query.lte('occurred_at', `${endDate}T23:59:59.999`);

        const { data, error } = await query;
        if (error) {
            rowsBody.innerHTML = '<tr><td class="text-center text-danger py-4" colspan="6">Não foi possível carregar a auditoria.</td></tr>';
            countLabel.textContent = 'Falha ao carregar';
            showError(error.message.includes('audit_logs')
                ? 'A tabela de auditoria ainda não foi criada. Execute supabase/audit.sql no SQL Editor.'
                : error.message);
            return;
        }

        events = data || [];
        renderEvents();
    }

    document.getElementById('btnFiltrarAuditoria').addEventListener('click', loadEvents);
    document.getElementById('btnLimparAuditoria').addEventListener('click', () => {
        document.getElementById('filtroEntidade').value = '';
        document.getElementById('filtroAcao').value = '';
        document.getElementById('filtroDataInicio').value = '';
        document.getElementById('filtroDataFim').value = '';
        searchInput.value = '';
        loadEvents();
    });
    searchInput.addEventListener('input', renderEvents);

    await loadEvents();
});
