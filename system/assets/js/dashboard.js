document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.supabaseClient === 'undefined') {
        console.error("Erro crítico: supabaseClient não foi inicializado.");
        return;
    }

    // Variáveis do sistema
    let usuarioLogado = null;
    let setorUsuario = '';
    let idLancamentoEdicao = null;

    // ==========================================
    // 1. INICIALIZAÇÃO E VERIFICAÇÃO DE PERFIL
    // ==========================================
    async function iniciarSistema() {
        const context = await window.requireModuleAccess('financeiro');
        if (!context) {
            return;
        }

        usuarioLogado = context.session.user;
        setorUsuario = context.sector;
        document.getElementById('infoUsuario').textContent = `${context.profile.nome || usuarioLogado.email} - ${setorUsuario}`;
        configurarTela(setorUsuario);

        await carregarLinhas();
        if (setorUsuario === 'Operacional') {
            window.mostrarAba('tabela');
        }
    }

    // ==========================================
    // 2. CARREGAR AS LINHAS DO BANCO NOS SELECTS
    // ==========================================
    async function carregarLinhas() {
        const { data, error } = await window.supabaseClient.from('linhas').select('id, nome').order('nome');
        const selectLinha = document.getElementById('linha');
        const filtroLinha = document.getElementById('filtroLinha');
        
        if (error) {
            console.error("Erro ao buscar linhas:", error);
            return;
        }

        if (data) {
            if (selectLinha) {
                selectLinha.innerHTML = '<option value="" selected disabled>Selecione uma linha...</option>';
                data.forEach(linha => {
                    selectLinha.innerHTML += `<option value="${linha.id}">${linha.nome}</option>`;
                });
            }

            if (filtroLinha) {
                filtroLinha.innerHTML = '<option value="" selected>Todas as Linhas</option>';
                data.forEach(linha => {
                    filtroLinha.innerHTML += `<option value="${linha.id}">${linha.nome}</option>`;
                });
            }
        }
    }

    // ==========================================
    // 3. CONTROLE DE PERMISSÕES NA TELA
    // ==========================================
    function configurarTela(setor) {
        const camposFin = document.getElementById('camposFinanceiros');
        const camposBilhetagem = document.getElementById('camposBilhetagem');
        const linkTabela = document.getElementById('linkTabela');
        const linkLancamento = document.getElementById('linkLancamento');
        const operacional = setor === 'Operacional';

        if(linkTabela) linkTabela.style.display = 'block';
        if (linkLancamento) linkLancamento.style.display = operacional ? 'none' : '';

        if (['Administração', 'Financeiro', 'TI'].includes(setor)) {
            if(camposFin) camposFin.style.display = 'block';
            if(linkTabela) linkTabela.textContent = 'Ver Todos';
        } else {
            if(camposFin) camposFin.style.display = 'none';
            if(linkTabela) linkTabela.textContent = 'Todos os Lançamentos';
        }

        if (camposBilhetagem) {
            camposBilhetagem.style.display = operacional ? 'none' : '';
        }

        const botaoSalvar = document.querySelector('#formLancamento button[type="submit"]');
        if (botaoSalvar) {
            botaoSalvar.textContent = operacional ? 'Salvar Complementação' : 'Salvar Lançamento';
        }

        const campoData = document.getElementById('dataOp');
        if (campoData) {
            campoData.readOnly = operacional;
        }

        if (operacional) {
            const cabecalho = document.querySelector('#abaTabela thead');
            if (cabecalho) {
                cabecalho.innerHTML = '<tr><th>Data</th><th>Linha</th><th>Excesso</th><th>KM</th><th>Ações</th></tr>';
            }
        }
    }

    // ==========================================
    // 4. NAVEGAÇÃO ENTRE ABAS
    // ==========================================
    window.mostrarAba = function(aba) {
        const linkLanc = document.getElementById('linkLancamento');
        const linkTab = document.getElementById('linkTabela');
        const painelFiltro = document.getElementById('painelFiltroSidebar');
        document.body.classList.toggle('dashboard-tabela', aba !== 'lancamento');

        if (aba === 'lancamento') {
            document.getElementById('abaLancamento').style.display = 'block';
            document.getElementById('abaTabela').style.display = 'none';
            if (painelFiltro) painelFiltro.style.display = 'none';
            document.getElementById('tituloPagina').textContent = idLancamentoEdicao ? 'Editando Lançamento' : 'Novo Lançamento';
            linkLanc.classList.add('active');
            linkTab.classList.remove('active');
        } else {
            document.getElementById('abaLancamento').style.display = 'none';
            document.getElementById('abaTabela').style.display = 'block';
            if (painelFiltro) painelFiltro.style.display = 'grid';
            
            document.getElementById('tituloPagina').textContent = 
                (['Administração', 'Financeiro', 'TI'].includes(setorUsuario)) 
                ? 'Todos os Lançamentos' 
                : 'Todos os Lançamentos';

            linkTab.classList.add('active');
            linkLanc.classList.remove('active');
            carregarTabela();
        }
    };

    // ==========================================
    // 5. LOGOUT
    // ==========================================
    window.logout = async function() {
        await window.supabaseClient.auth.signOut();
        localStorage.clear();
        window.location.href = 'index.html';
    };

    // ==========================================
    // 6. FORMULÁRIO (SALVAR E EDITAR)
    // ==========================================
    const formLancamento = document.getElementById('formLancamento');
    if (formLancamento) {
        formLancamento.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = e.target.querySelector('button[type="submit"]');
            btnSubmit.disabled = true;

            const vGaragem = document.getElementById('vGaragem').value || 0;
            const vCity = document.getElementById('vCity').value || 0;
            const vExcesso = document.getElementById('vExcesso').value || 0;
            const comum = document.getElementById('vComum').value || 0;
            const escolar = document.getElementById('vEscolar').value || 0;
            const pagantes = document.getElementById('vPagantes').value || 0;
            const vt = document.getElementById('vVt').value || 0;
            const linhaId = document.getElementById('linha').value;

            if(!linhaId) {
                alert("Por favor, selecione uma linha.");
                btnSubmit.disabled = false;
                return;
            }

            // Envia os dados para o banco
            const dadosLancamento = {
                data_op: document.getElementById('dataOp').value,
                linha_id: parseInt(linhaId), 
                valor_garagem: parseFloat(vGaragem),
                valor_city: parseFloat(vCity),
                valor_excesso: parseFloat(vExcesso),
                comum: parseFloat(comum),
                escolar: parseFloat(escolar),
                pagantes: parseFloat(pagantes),
                vt: parseFloat(vt),
                km_rodado: parseFloat(document.getElementById('kmRodado').value)
            };

            const operacional = setorUsuario === 'Operacional';
            if (operacional && !idLancamentoEdicao) {
                alert('O setor Operacional só pode completar lançamentos existentes.');
                btnSubmit.disabled = false;
                return;
            }

            const { error } = await window.supabaseClient.rpc('salvar_lancamento', {
                p_lancamento_id: idLancamentoEdicao,
                p_dados: dadosLancamento
            });

            btnSubmit.disabled = false;

            if (error) {
                alert('Erro ao salvar: ' + error.message);
            } else {
                const msg = document.getElementById('msgSucesso');
                msg.textContent = idLancamentoEdicao ? 'Lançamento atualizado!' : 'Lançamento criado!';
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 3000);
                
                formLancamento.reset();
                idLancamentoEdicao = null;
                document.getElementById('tituloPagina').textContent = 'Novo Lançamento';
                btnSubmit.textContent = 'Salvar Lançamento';
                
                if (document.getElementById('abaTabela').style.display === 'block') {
                    carregarTabela();
                } else {
                    window.mostrarAba('lancamento');
                }
            }
        });
    }

    // ==========================================
    // 7. CARREGAR TABELA (COM JOIN NA TABELA LINHAS E FILTRO DE DATAS)
    // ==========================================
    async function carregarTabela() {
        const operacional = setorUsuario === 'Operacional';
        const linhaFiltroId = document.getElementById('filtroLinha').value;
        const dataInicio = document.getElementById('filtroDataInicio').value;
        const dataFim = document.getElementById('filtroDataFim').value;
        const { data, error } = await window.supabaseClient.rpc('listar_lancamentos_dashboard', {
            p_linha_id: linhaFiltroId ? Number(linhaFiltroId) : null,
            p_data_inicio: dataInicio || null,
            p_data_fim: dataFim || null
        });
        
        const tbody = document.getElementById('tabelaCorpo');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        if (!error && data) {
            data.forEach(item => {
                const podeEditar = operacional || ['Administração', 'Financeiro', 'TI'].includes(setorUsuario);
                const btnAcao = podeEditar
                    ? `<button class="btn btn-sm btn-outline-primary" onclick="prepararEdicao('${item.id}')">Editar</button>` 
                    : '';
                
                const nomeDaLinha = item.linhas ? item.linhas.nome : 'Linha Excluída';

                if (operacional) {
                    tbody.innerHTML += `
                        <tr>
                            <td>${new Date(item.data_op + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                            <td>${nomeDaLinha}</td>
                            <td>R$ ${(item.valor_excesso || 0).toFixed(2)}</td>
                            <td>${item.km_rodado || 0} km</td>
                            <td>${btnAcao}</td>
                        </tr>
                    `;
                    return;
                }

                tbody.innerHTML += `
                    <tr>
                        <td>${new Date(item.data_op + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                        <td>${nomeDaLinha}</td>
                        <td>R$ ${(item.valor_garagem || 0).toFixed(2)}</td>
                        <td>R$ ${(item.valor_city || 0).toFixed(2)}</td>
                        <td>R$ ${(item.valor_excesso || 0).toFixed(2)}</td>
                        <td>R$ ${(item.comum || 0).toFixed(2)}</td>
                        <td>R$ ${(item.escolar || 0).toFixed(2)}</td>
                        <td>R$ ${(item.pagantes || 0).toFixed(2)}</td>
                        <td>R$ ${(item.vt || 0).toFixed(2)}</td>
                        <td>${item.km_rodado} km</td>
                        <td class="fw-bold text-success">R$ ${(item.valor_total || 0).toFixed(2)}</td>
                        <td>${btnAcao}</td>
                    </tr>
                `;
            });
        }
    }

    // ==========================================
    // 8. PREPARAR EDIÇÃO
    // ==========================================
    window.prepararEdicao = async function(id) {
        if (!['Administração', 'Financeiro', 'Operacional', 'TI'].includes(setorUsuario)) {
            alert('Seu setor não tem permissão para editar lançamentos.');
            return;
        }

        const { data, error } = await window.supabaseClient.rpc('obter_lancamento_edicao', {
            p_lancamento_id: id
        });
        
        if (data) {
            idLancamentoEdicao = id;
            
            document.getElementById('dataOp').value = data.data_op;
            document.getElementById('linha').value = data.linha_id; // Seleciona o ID correto no select
            document.getElementById('vGaragem').value = data.valor_garagem;
            document.getElementById('vCity').value = data.valor_city;
            document.getElementById('vExcesso').value = data.valor_excesso;
            document.getElementById('vComum').value = data.comum || 0;
            document.getElementById('vEscolar').value = data.escolar || 0;
            document.getElementById('vPagantes').value = data.pagantes || 0;
            document.getElementById('vVt').value = data.vt || 0;
            document.getElementById('kmRodado').value = data.km_rodado;

            document.getElementById('tituloPagina').textContent = 'Editando Lançamento';
            document.querySelector('#formLancamento button[type="submit"]').textContent = 'Atualizar Lançamento';

            window.mostrarAba('lancamento');
        } else if (error) {
            alert('Não foi possível carregar o lançamento para edição. Verifique a permissão no banco de dados.');
        }
    };

    // Event listeners para os botões de filtro na tabela
    const btnFiltrar = document.getElementById('btnFiltrar');
    if (btnFiltrar) {
        btnFiltrar.addEventListener('click', () => {
            carregarTabela();
        });
    }

    const btnLimparFiltro = document.getElementById('btnLimparFiltro');
    if (btnLimparFiltro) {
        btnLimparFiltro.addEventListener('click', () => {
            document.getElementById('filtroLinha').value = '';
            document.getElementById('filtroDataInicio').value = '';
            document.getElementById('filtroDataFim').value = '';
            carregarTabela();
        });
    }

    iniciarSistema();
});