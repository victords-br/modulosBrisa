document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient || !window.requireModuleAccess) {
        console.error('Supabase ou controle de acesso não foi inicializado.');
        return;
    }

    const context = await window.requireModuleAccess('motorista');
    if (!context) return;

    const list = document.getElementById('listaEscalaMotorista');
    const summary = document.getElementById('resumoEscala');
    const message = document.getElementById('mensagemMotorista');
    const startInput = document.getElementById('dataInicioMotorista');
    const endInput = document.getElementById('dataFimMotorista');

    document.getElementById('motoristaNome').textContent = context.profile.nome || context.session.user.email;
    document.getElementById('btnSairMotorista').addEventListener('click', window.logout);

    function formatDateInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    startInput.value = formatDateInput(today);
    endInput.value = formatDateInput(nextWeek);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function formatDay(dateString) {
        const date = new Date(`${dateString}T00:00:00`);
        return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function renderSchedule(rows) {
        summary.textContent = `${rows.length} escala(s) no período`;
        if (rows.length === 0) {
            list.innerHTML = '<div class="motorista-vazio"><h2 class="h5">Nenhuma escala neste período</h2><p class="text-muted mb-0">Altere as datas para consultar outro período.</p></div>';
            return;
        }

        const groups = new Map();
        rows.forEach(row => {
            if (!groups.has(row.data_escala)) groups.set(row.data_escala, []);
            groups.get(row.data_escala).push(row);
        });

        list.innerHTML = Array.from(groups.entries()).map(([date, shifts]) => `
            <section class="motorista-dia">
                <h2>${escapeHtml(formatDay(date))}</h2>
                ${shifts.map(shift => `
                    <article class="motorista-turno">
                        <div class="motorista-horario">${escapeHtml(shift.hora_inicio?.slice(0, 5) || '--:--')} – ${escapeHtml(shift.hora_fim?.slice(0, 5) || '--:--')}</div>
                        <div>
                            <div class="motorista-linha">${escapeHtml(shift.linha_nome || 'Linha não informada')}</div>
                            <div class="motorista-detalhe">Carro ${escapeHtml(shift.numero_ordem || 'não informado')}${shift.modelo ? ` · ${escapeHtml(shift.modelo)}` : ''}</div>
                            ${(shift.local_inicio || shift.local_final) ? `<div class="motorista-trajeto"><span>Início: ${escapeHtml(shift.local_inicio || '—')}</span><span>Final: ${escapeHtml(shift.local_final || '—')}</span></div>` : ''}
                        </div>
                    </article>
                `).join('')}
            </section>
        `).join('');
    }

    async function loadSchedule(event) {
        if (event) event.preventDefault();
        message.classList.add('d-none');
        list.innerHTML = '<div class="text-center text-muted py-5">Carregando escala...</div>';

        if (!startInput.value || !endInput.value || endInput.value < startInput.value) {
            message.textContent = 'Informe um período válido.';
            message.className = 'alert alert-warning';
            return;
        }

        const { data, error } = await window.supabaseClient.rpc('minhas_escalas_motorista', {
            p_data_inicio: startInput.value,
            p_data_fim: endInput.value
        });

        if (error) {
            list.innerHTML = '';
            message.textContent = error.message.includes('vinculada a um motorista')
                ? 'Sua conta ainda não está vinculada ao cadastro de motorista. Procure o setor de TI.'
                : 'Não foi possível carregar sua escala. Tente novamente ou procure o setor de TI.';
            message.className = 'alert alert-danger';
            message.classList.remove('d-none');
            summary.textContent = '';
            return;
        }

        renderSchedule(data || []);
    }

    document.getElementById('formFiltroMotorista').addEventListener('submit', loadSchedule);
    await loadSchedule();
});
