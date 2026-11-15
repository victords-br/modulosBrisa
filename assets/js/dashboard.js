document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.supabaseClient === 'undefined') {
        console.error("Erro crítico: supabaseClient não foi inicializado.");
        return;
    }

    // Variáveis do sistema
    let usuarioLogado = null;
    let setorUsuario = '';
    let idLancamentoEdicao = null;
    let escalasLancamento = [];
    let sequenciaCarregamentoViagens = 0;

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

    function escaparHtml(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[caractere]);
    }

    function formatarHoraLancamento(hora) {
        return hora ? String(hora).slice(0, 5) : '--:--';
    }

    async function carregarViagensLancamento() {
        const lista = document.getElementById('listaViagens');
        const status = document.getElementById('statusViagens');
        const dataOp = document.getElementById('dataOp').value;
        const linhaId = document.getElementById('linha').value;
        const sequencia = ++sequenciaCarregamentoViagens;
        const botaoSalvar = document.getElementById('btnSalvarLancamento');
        escalasLancamento = [];

        if (!lista || !dataOp || !linhaId) {
            if (lista) lista.innerHTML = '';
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = 'Selecione a data e a linha para carregar as viagens da escala.';
            return;
        }

        lista.innerHTML = '';
        if (botaoSalvar) botaoSalvar.disabled = true;
        if (status) status.textContent = 'Carregando viagens da escala...';
        const [resultadoEscalas, resultadoLancamentos] = await Promise.all([
            window.supabaseClient.from('escalas_trabalho')
                .select('id, hora_inicio, hora_fim')
                .eq('data_escala', dataOp)
                .eq('linha_id', Number(linhaId))
                .order('hora_inicio'),
            window.supabaseClient.rpc('listar_lancamentos_dashboard', {
                p_linha_id: Number(linhaId),
                p_data_inicio: dataOp,
                p_data_fim: dataOp
            })
        ]);

        if (sequencia !== sequenciaCarregamentoViagens) return;
        if (resultadoEscalas.error) {
            console.error('Erro ao carregar viagens da escala:', resultadoEscalas.error);
            document.getElementById('camposLancamentoLegado').style.display = 'none';
            if (status) status.textContent = 'Não foi possível carregar as viagens da escala.';
            return;
        }
        if (resultadoLancamentos.error) {
            console.error('Erro ao carregar lançamentos por viagem:', resultadoLancamentos.error);
            document.getElementById('camposLancamentoLegado').style.display = 'none';
            if (status) status.textContent = 'Não foi possível conferir os lançamentos existentes. Atualize a tela e tente novamente.';
            return;
        }

        const lancamentosPorEscala = new Map((resultadoLancamentos.data || [])
            .filter(item => item.escala_id)
            .map(item => [String(item.escala_id), item]));
        escalasLancamento = resultadoEscalas.data || [];

        if (setorUsuario === 'Operacional') {
            escalasLancamento = [];
            lista.innerHTML = '';
            document.getElementById('camposLancamentoLegado').style.display = 'block';
            document.getElementById('kmRodado').required = true;
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = 'A escala possui viagens neste dia. Use os campos operacionais para complementar o lançamento.';
            return;
        }

        if (escalasLancamento.length === 0) {
            lista.innerHTML = '';
            document.getElementById('camposLancamentoLegado').style.display = 'block';
            document.getElementById('kmRodado').required = true;
            document.getElementById('btnSalvarLancamento').textContent = 'Salvar Lançamento';
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = 'Não há viagens cadastradas na escala para esta linha e data.';
            return;
        }

        document.getElementById('camposLancamentoLegado').style.display = 'none';
        document.getElementById('kmRodado').required = false;
        document.getElementById('btnSalvarLancamento').textContent = 'Salvar Lançamentos por Viagem';
        if (botaoSalvar) botaoSalvar.disabled = false;
        if (status) status.textContent = `${escalasLancamento.length} ${escalasLancamento.length === 1 ? 'viagem carregada' : 'viagens carregadas'} da escala.`;
        lista.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light"><tr>
                <th>Horário da escala</th><th>Garagem (R$)</th><th>City (R$)</th><th>Excesso (R$)</th>
                <th>Comum (qtd.)</th><th>Escolar (qtd.)</th><th>Pagantes (qtd.)</th><th>VT (qtd.)</th><th>KM</th>
            </tr></thead><tbody>${escalasLancamento.map(escala => {
                const id = String(escala.id);
                const lancamento = lancamentosPorEscala.get(id) || {};
                const entrada = (campo, valor) => `<input class="form-control form-control-sm" type="number" min="0" step="0.01" data-campo="${campo}" value="${Number(valor || 0)}" aria-label="${campo} da viagem ${formatarHoraLancamento(escala.hora_inicio)}">`;
                const quantidade = (campo, valor) => `<input class="form-control form-control-sm" type="number" min="0" step="1" data-campo="${campo}" value="${Number(valor || 0)}" aria-label="${campo} da viagem ${formatarHoraLancamento(escala.hora_inicio)}">`;
                return `<tr data-escala-id="${escaparHtml(id)}" data-lancamento-id="${escaparHtml(lancamento.id || '')}">
                    <th class="text-nowrap">${escaparHtml(formatarHoraLancamento(escala.hora_inicio))} - ${escaparHtml(formatarHoraLancamento(escala.hora_fim))}</th>
                    <td>${entrada('valor_garagem', lancamento.valor_garagem)}</td>
                    <td>${entrada('valor_city', lancamento.valor_city)}</td>
                    <td>${entrada('valor_excesso', lancamento.valor_excesso)}</td>
                    <td>${quantidade('quantidade_comum', lancamento.quantidade_comum)}</td>
                    <td>${quantidade('quantidade_escolar', lancamento.quantidade_escolar)}</td>
                    <td>${quantidade('quantidade_pagantes', lancamento.quantidade_pagantes)}</td>
                    <td>${quantidade('quantidade_vt', lancamento.quantidade_vt)}</td>
                    <td>${entrada('km_rodado', lancamento.km_rodado)}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`;
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
        document.getElementById('dataOp').addEventListener('change', carregarViagensLancamento);
        document.getElementById('linha').addEventListener('change', carregarViagensLancamento);

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

            let error;
            if (escalasLancamento.length) {
                const viagens = [...document.querySelectorAll('#listaViagens tbody tr[data-escala-id]')].map(linhaViagem => {
                    const valores = Object.fromEntries([...linhaViagem.querySelectorAll('[data-campo]')]
                        .map(campo => [campo.dataset.campo, Number(campo.value || 0)]));
                    return { escala_id: linhaViagem.dataset.escalaId, ...valores };
                });
                ({ error } = await window.supabaseClient.rpc('salvar_lancamentos_por_viagem', {
                    p_data_op: dadosLancamento.data_op,
                    p_linha_id: dadosLancamento.linha_id,
                    p_viagens: viagens
                }));
            } else {
                ({ error } = await window.supabaseClient.rpc('salvar_lancamento', {
                    p_lancamento_id: idLancamentoEdicao,
                    p_dados: dadosLancamento
                }));
            }

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
                await carregarViagensLancamento();
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
            const grupos = new Map();
            data.forEach(item => {
                const chave = `${item.data_op}:${item.linha_id}`;
                if (!grupos.has(chave)) grupos.set(chave, []);
                grupos.get(chave).push(item);
            });

            const moeda = valor => `R$ ${Number(valor || 0).toFixed(2)}`;
            const numero = (itens, campo) => itens.reduce((total, item) => total + Number(item[campo] || 0), 0);
            [...grupos.values()].forEach((itens, indice) => {
                const primeiro = itens[0];
                const nomeDaLinha = escaparHtml(primeiro.linhas?.nome || 'Linha Excluída');
                const dataFormatada = new Date(primeiro.data_op + 'T00:00:00').toLocaleDateString('pt-BR');
                const colspan = operacional ? 5 : 12;
                const botaoDetalhes = `<button class="btn btn-sm btn-outline-secondary" type="button" data-expandir="detalhes-${indice}" aria-expanded="false">${itens.length} viagem(ns)</button>`;
                const nomeClicavel = `<button class="btn btn-link p-0 text-start" type="button" data-expandir="detalhes-${indice}" aria-expanded="false">${nomeDaLinha}</button>`;
                let linhaResumo;

                if (operacional) {
                    linhaResumo = `<tr>
                        <td>${dataFormatada}</td><td>${nomeClicavel}</td>
                        <td>${moeda(numero(itens, 'valor_excesso'))}</td>
                        <td>${numero(itens, 'km_rodado').toFixed(2)} km</td><td>${botaoDetalhes}</td>
                    </tr>`;
                } else {
                    linhaResumo = `<tr>
                        <td>${dataFormatada}</td><td>${nomeClicavel}</td>
                        <td>${moeda(numero(itens, 'valor_garagem'))}</td><td>${moeda(numero(itens, 'valor_city'))}</td>
                        <td>${moeda(numero(itens, 'valor_excesso'))}</td><td>${moeda(numero(itens, 'comum'))}</td>
                        <td>${moeda(numero(itens, 'escolar'))}</td><td>${moeda(numero(itens, 'pagantes'))}</td>
                        <td>${moeda(numero(itens, 'vt'))}</td><td>${numero(itens, 'km_rodado').toFixed(2)} km</td>
                        <td class="fw-bold text-success">${moeda(numero(itens, 'valor_total'))}</td><td>${botaoDetalhes}</td>
                    </tr>`;
                }

                const detalhes = itens.map(item => {
                    const horario = `${formatarHoraLancamento(item.hora_inicio)} - ${formatarHoraLancamento(item.hora_fim)}`;
                    const botaoEditar = (operacional || ['Administração', 'Financeiro', 'TI'].includes(setorUsuario))
                        ? `<button class="btn btn-sm btn-outline-primary" type="button" data-editar-lancamento="${escaparHtml(item.id)}">Editar</button>`
                        : '';
                    if (operacional) {
                        return `<tr><td>${escaparHtml(horario)}</td><td>${moeda(item.valor_excesso)}</td><td>${Number(item.km_rodado || 0).toFixed(2)} km</td><td>${botaoEditar}</td></tr>`;
                    }
                    return `<tr>
                        <td>${escaparHtml(horario)}</td><td>${moeda(item.valor_garagem)}</td><td>${moeda(item.valor_city)}</td>
                        <td>${moeda(item.valor_excesso)}</td><td>${Number(item.quantidade_comum || 0)}</td><td>${moeda(item.comum)}</td>
                        <td>${Number(item.quantidade_escolar || 0)}</td><td>${moeda(item.escolar)}</td>
                        <td>${Number(item.quantidade_pagantes || 0)}</td><td>${moeda(item.pagantes)}</td>
                        <td>${Number(item.quantidade_vt || 0)}</td><td>${moeda(item.vt)}</td>
                        <td>${Number(item.km_rodado || 0).toFixed(2)} km</td><td>${botaoEditar}</td>
                    </tr>`;
                }).join('');
                const cabecalhoDetalhes = operacional
                    ? '<tr><th>Horário</th><th>Excesso</th><th>KM</th><th>Ações</th></tr>'
                    : '<tr><th>Horário</th><th>Garagem</th><th>City</th><th>Excesso</th><th>Comum qtd.</th><th>Comum R$</th><th>Escolar qtd.</th><th>Escolar R$</th><th>Pagantes qtd.</th><th>Pagantes R$</th><th>VT qtd.</th><th>VT R$</th><th>KM</th><th>Ações</th></tr>';
                tbody.insertAdjacentHTML('beforeend', `${linhaResumo}<tr id="detalhes-${indice}" class="table-light" style="display:none"><td colspan="${colspan}"><div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0"><thead>${cabecalhoDetalhes}</thead><tbody>${detalhes}</tbody></table></div></td></tr>`);
            });

            if (!tbody.dataset.acoesDetalhes) {
                tbody.addEventListener('click', event => {
                    const expandir = event.target.closest('button[data-expandir]');
                    if (expandir) {
                        const linhaDetalhes = document.getElementById(expandir.dataset.expandir);
                        const aberto = linhaDetalhes.style.display !== 'none';
                        linhaDetalhes.style.display = aberto ? 'none' : '';
                        expandir.setAttribute('aria-expanded', String(!aberto));
                    }
                    const editar = event.target.closest('button[data-editar-lancamento]');
                    if (editar) window.prepararEdicao(editar.dataset.editarLancamento);
                });
                tbody.dataset.acoesDetalhes = 'true';
            }
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
            await carregarViagensLancamento();
            if (!data.escala_id) {
                escalasLancamento = [];
                document.getElementById('listaViagens').innerHTML = '';
                document.getElementById('camposLancamentoLegado').style.display = 'block';
                document.getElementById('kmRodado').required = true;
                document.getElementById('btnSalvarLancamento').textContent = 'Atualizar Lançamento';
            }
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