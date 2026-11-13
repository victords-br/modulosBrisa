document.addEventListener('DOMContentLoaded', async () => {
    if (!window.supabaseClient || !window.requireModuleAccess) {
        console.error('Supabase ou controle de acesso não foi inicializado.');
        return;
    }

    const context = await window.requireModuleAccess('usuarios');
    if (!context) return;

    const currentUserId = context.session.user.id;
    const usersBody = document.getElementById('corpoUsuarios');
    const searchInput = document.getElementById('buscaUsuarios');
    const countLabel = document.getElementById('contadorUsuarios');
    const message = document.getElementById('mensagem');
    const form = document.getElementById('formUsuario');
    const sectorSelect = document.getElementById('usuarioSetor');
    const driverSelect = document.getElementById('usuarioFuncionarioId');
    const driverLinkWrap = document.getElementById('vinculoMotoristaWrap');
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalUsuario'));
    let users = [];
    let sectors = [];
    let drivers = [];
    let driverListAvailable = false;

    document.getElementById('infoUsuario').textContent = `${context.profile.nome || context.session.user.email} - ${context.sector}`;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function showMessage(text, kind = 'success') {
        message.className = `alert alert-${kind}`;
        message.textContent = text;
        message.classList.remove('d-none');
    }

    function hideMessage() {
        message.classList.add('d-none');
    }

    async function invokeAdmin(action, payload = {}) {
        const { data, error } = await window.supabaseClient.functions.invoke('manage-users', {
            body: { action, ...payload }
        });

        if (error) {
            let detail = error.message;
            if (error.context && typeof error.context.json === 'function') {
                try {
                    const response = await error.context.json();
                    detail = response.error || detail;
                } catch (_) {
                }
            }
            if (detail.includes('Failed to send a request to the Edge Function')) {
                detail = 'A função manage-users não foi encontrada ou não respondeu. Publique-a no Supabase com: supabase functions deploy manage-users';
            } else if (detail.includes('Sessão inválida ou expirada')) {
                detail = 'Sua sessão expirou. Saia do sistema, entre novamente e recarregue a tela.';
            }
            throw new Error(detail || 'Falha ao comunicar com o serviço de usuários.');
        }

        if (data && data.error) {
            throw new Error(data.error);
        }

        return data;
    }

    function renderUsers() {
        const search = searchInput.value.trim().toLocaleLowerCase('pt-BR');
        const filteredUsers = users.filter(user =>
            `${user.name} ${user.email}`.toLocaleLowerCase('pt-BR').includes(search)
        );

        countLabel.textContent = `${filteredUsers.length} de ${users.length} usuários`;
        if (filteredUsers.length === 0) {
            usersBody.innerHTML = '<tr><td class="text-center text-muted py-4" colspan="6">Nenhum usuário encontrado.</td></tr>';
            return;
        }

        usersBody.innerHTML = filteredUsers.map(user => {
            const statusClass = user.email_confirmed ? 'text-success' : 'text-warning';
            const statusText = user.email_confirmed ? 'Confirmado' : 'Pendente';
            const createdAt = user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '-';
            const deleteButton = user.id === currentUserId
                ? '<button class="btn btn-sm btn-outline-secondary" type="button" disabled title="Não é possível excluir sua própria conta">Excluir</button>'
                : `<button class="btn btn-sm btn-outline-danger" type="button" data-action="delete" data-user-id="${escapeHtml(user.id)}">Excluir</button>`;

            return `<tr>
                <td class="fw-semibold">${escapeHtml(user.name || 'Sem nome')}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>${escapeHtml(user.sector || 'Sem setor')}${user.driver ? `<div class="small text-muted">${escapeHtml(user.driver)}</div>` : ''}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td>${createdAt}</td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm btn-outline-primary me-1" type="button" data-action="edit" data-user-id="${escapeHtml(user.id)}">Editar</button>
                    ${deleteButton}
                </td>
            </tr>`;
        }).join('');
    }

    async function loadUsers() {
        usersBody.innerHTML = '<tr><td class="text-center text-muted py-4" colspan="6">Carregando usuários...</td></tr>';
        try {
            const data = await invokeAdmin('list');
            users = data.users || [];
            sectors = data.sectors || [];
            driverListAvailable = Array.isArray(data.drivers);
            drivers = driverListAvailable ? data.drivers : [];
            sectorSelect.innerHTML = sectors.map(sector =>
                `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.name)}</option>`
            ).join('');
            const driverPlaceholder = drivers.length
                ? '<option value="">Selecione o motorista...</option>'
                : `<option value="">${driverListAvailable ? 'Nenhum funcionário cadastrado.' : 'Lista indisponível. Republique manage-users e atualize a sessão.'}</option>`;
            driverSelect.innerHTML = driverPlaceholder + drivers.map(driver =>
                `<option value="${escapeHtml(driver.id)}">${escapeHtml(driver.name)} (${escapeHtml(driver.matricula)})</option>`
            ).join('');
            renderUsers();
        } catch (error) {
            usersBody.innerHTML = '<tr><td class="text-center text-danger py-4" colspan="6">Não foi possível carregar os usuários.</td></tr>';
            countLabel.textContent = 'Falha ao carregar';
            const message = error.message.includes('funcionario_id')
                ? 'O vínculo de motoristas ainda não foi instalado. Execute driver_access.sql e publique novamente manage-users.'
                : error.message;
            showMessage(message, 'danger');
        }
    }

    function openCreateForm() {
        hideMessage();
        form.reset();
        document.getElementById('usuarioId').value = '';
        updateDriverLink();
        document.getElementById('usuarioConfirmado').checked = true;
        document.getElementById('usuarioSenha').required = true;
        document.getElementById('ajudaSenha').textContent = 'Obrigatória para criar uma conta; mínimo de 8 caracteres.';
        document.getElementById('tituloModalUsuario').textContent = 'Novo usuário';
        document.getElementById('btnSalvarUsuario').textContent = 'Criar usuário';
        modal.show();
    }

    function openEditForm(user) {
        hideMessage();
        form.reset();
        document.getElementById('usuarioId').value = user.id;
        document.getElementById('usuarioNome').value = user.name || '';
        document.getElementById('usuarioEmail').value = user.email || '';
        document.getElementById('usuarioSetor').value = String(user.sector_id || '');
        driverSelect.value = user.funcionario_id || '';
        updateDriverLink();
        document.getElementById('usuarioSenha').value = '';
        document.getElementById('usuarioSenha').required = false;
        document.getElementById('ajudaSenha').textContent = 'Deixe em branco para manter a senha atual.';
        document.getElementById('usuarioConfirmado').checked = user.email_confirmed;
        document.getElementById('tituloModalUsuario').textContent = 'Editar usuário';
        document.getElementById('btnSalvarUsuario').textContent = 'Salvar alterações';
        modal.show();
    }

    function updateDriverLink() {
        const selectedSector = sectors.find(sector => String(sector.id) === sectorSelect.value);
        const isDriver = selectedSector?.name === 'Motorista';
        driverLinkWrap.classList.toggle('d-none', !isDriver);
        driverSelect.required = isDriver;
        if (!isDriver) driverSelect.value = '';
    }

    document.getElementById('btnNovoUsuario').addEventListener('click', openCreateForm);
    document.getElementById('btnLogout').addEventListener('click', window.logout);
    searchInput.addEventListener('input', renderUsers);
    sectorSelect.addEventListener('change', updateDriverLink);

    usersBody.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const user = users.find(item => item.id === button.dataset.userId);
        if (!user) return;

        if (button.dataset.action === 'edit') {
            openEditForm(user);
            return;
        }

        if (user.id === currentUserId || !window.confirm(`Excluir o usuário ${user.email}? Esta ação não pode ser desfeita.`)) {
            return;
        }

        button.disabled = true;
        try {
            await invokeAdmin('delete', { user_id: user.id });
            showMessage(`Usuário ${user.email} excluído.`);
            await loadUsers();
        } catch (error) {
            showMessage(error.message, 'danger');
            button.disabled = false;
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        hideMessage();

        const userId = document.getElementById('usuarioId').value;
        const password = document.getElementById('usuarioSenha').value;
        const selectedSector = sectors.find(sector => String(sector.id) === sectorSelect.value);
        const payload = {
            name: document.getElementById('usuarioNome').value.trim(),
            email: document.getElementById('usuarioEmail').value.trim(),
            sector_id: Number(sectorSelect.value),
            funcionario_id: selectedSector?.name === 'Motorista' ? driverSelect.value : null,
            email_confirmed: document.getElementById('usuarioConfirmado').checked
        };

        if (password) payload.password = password;

        const saveButton = document.getElementById('btnSalvarUsuario');
        saveButton.disabled = true;
        try {
            await invokeAdmin(userId ? 'update' : 'create', {
                ...payload,
                ...(userId ? { user_id: userId } : {})
            });
            modal.hide();
            showMessage(userId ? 'Usuário atualizado.' : 'Usuário criado.');
            await loadUsers();
        } catch (error) {
            showMessage(error.message, 'danger');
        } finally {
            saveButton.disabled = false;
        }
    });

    await loadUsers();
});
