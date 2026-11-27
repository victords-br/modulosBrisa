document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.supabaseClient === 'undefined') {
        console.error("Erro crítico: supabaseClient não foi inicializado.");
        return;
    }

    // Variáveis do sistema
    let usuarioLogado = null;
    let setorUsuario = '';
    let idLancamentoEdicao = null;
    let trechosLancamento = [];
    let sequenciaCarregamentoViagens = 0;
    let tarifasLancamento = null;

    const NOMES_TIPO_DIA = { 1: 'Úteis', 2: 'Sábado', 3: 'Domingo' };
    const TIPOS_DIA_POR_DIA_SEMANA = { 0: 3, 6: 2 };

    function tipoDiaPorData(dataIso) {
        const diaSemana = new Date(`${dataIso}T00:00:00`).getDay();
        return TIPOS_DIA_POR_DIA_SEMANA[diaSemana] || 1;
    }

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
        await carregarTarifas();
        if (setorUsuario === 'Operacional') {
            window.mostrarAba('tabela');
        }
    }

    // ==========================================
    // CARREGAR AS TARIFAS (PARA O INDICADOR R$ / KM)
    // ==========================================
    async function carregarTarifas() {
        if (setorUsuario === 'Operacional') return;

        const { data, error } = await window.supabaseClient.rpc('obter_tarifas_lancamento_publico');
        if (error) {
            console.error('Não foi possível carregar as tarifas. Execute a migração horarios_operacao.sql no SQL Editor.', error);
            return;
        }
        if (data) {
            tarifasLancamento = {
                comum: Number(data.comum || 0),
                escolar: Number(data.escolar || 0),
                vt: Number(data.vt || 0),
                pagantes: Number(data.pagantes || 0)
            };
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

    function calcularValoresViagem(linhaViagem) {
        return Object.fromEntries([...linhaViagem.querySelectorAll('[data-campo]')]
            .map(campo => [campo.dataset.campo, Number(campo.value || 0)]));
    }

    function atualizarResumoTrecho(linhaViagem) {
        const detalhe = document.querySelector(`#listaViagens tr[data-detalhe-de="${linhaViagem.dataset.horarioOperacaoId}"]`);
        if (!detalhe) return;

        const valores = calcularValoresViagem(linhaViagem);
        const tarifas = tarifasLancamento || { comum: 0, escolar: 0, vt: 0, pagantes: 0 };
        const total = valores.quantidade_comum * tarifas.comum
            + valores.quantidade_escolar * tarifas.escolar
            + valores.quantidade_vt * tarifas.vt
            + valores.quantidade_motorista * tarifas.pagantes
            + valores.valor_excesso;
        const km = valores.km_rodado;
        const rsPorKm = km > 0 ? total / km : 0;
        const cor = (tarifas.vt || 0) > 0 ? (rsPorKm >= tarifas.vt ? 'text-success' : 'text-danger') : '';

        const resumo = detalhe.querySelector('[data-resumo-trecho]');
        resumo.innerHTML = `Total do trecho: <strong>R$ ${total.toFixed(2)}</strong>`
            + ` &middot; KM: ${km.toFixed(2)}`
            + ` &middot; <span class="${cor}">R$ / km: <strong>R$ ${rsPorKm.toFixed(2)}</strong></span>`;
    }

    async function carregarViagensLancamento() {
        const lista = document.getElementById('listaViagens');
        const status = document.getElementById('statusViagens');
        const dataOp = document.getElementById('dataOp').value;
        const linhaId = document.getElementById('linha').value;
        const sequencia = ++sequenciaCarregamentoViagens;
        const botaoSalvar = document.getElementById('btnSalvarLancamento');
        trechosLancamento = [];

        if (!lista || !dataOp || !linhaId) {
            if (lista) lista.innerHTML = '';
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = 'Selecione a data e a linha para carregar os trechos da grade operacional.';
            return;
        }

        const tipoDiaId = tipoDiaPorData(dataOp);
        lista.innerHTML = '';
        if (botaoSalvar) botaoSalvar.disabled = true;
        if (status) status.textContent = 'Carregando trechos da grade...';
        const [resultadoHorarios, resultadoLancamentos] = await Promise.all([
            window.supabaseClient.from('horarios_operacao')
                .select('id, tabela, ida_volta, horario_saida, horario_chegada, local_saida, local_chegada, distancia_km')
                .eq('linha_id', Number(linhaId))
                .eq('tipo_dia_id', tipoDiaId)
                .order('horario_saida'),
            window.supabaseClient.rpc('listar_lancamentos_dashboard', {
                p_linha_id: Number(linhaId),
                p_data_inicio: dataOp,
                p_data_fim: dataOp
            })
        ]);

        if (sequencia !== sequenciaCarregamentoViagens) return;
        if (resultadoHorarios.error) {
            console.error('Erro ao carregar a grade operacional:', resultadoHorarios.error);
            document.getElementById('camposLancamentoLegado').style.display = 'none';
            if (status) status.textContent = 'Não foi possível carregar os trechos da grade. Execute a migração horarios_operacao.sql no SQL Editor.';
            return;
        }
        if (resultadoLancamentos.error) {
            console.error('Erro ao carregar lançamentos por viagem:', resultadoLancamentos.error);
            document.getElementById('camposLancamentoLegado').style.display = 'none';
            if (status) status.textContent = 'Não foi possível conferir os lançamentos existentes. Atualize a tela e tente novamente.';
            return;
        }

        const lancamentosPorTrecho = new Map((resultadoLancamentos.data || [])
            .filter(item => item.horario_operacao_id)
            .map(item => [String(item.horario_operacao_id), item]));
        trechosLancamento = resultadoHorarios.data || [];

        if (setorUsuario === 'Operacional') {
            trechosLancamento = [];
            lista.innerHTML = '';
            document.getElementById('camposLancamentoLegado').style.display = 'block';
            document.getElementById('kmRodado').required = true;
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = 'Use os campos operacionais para complementar o lançamento.';
            return;
        }

        const nomeTipoDia = NOMES_TIPO_DIA[tipoDiaId] || 'Úteis';

        if (trechosLancamento.length === 0) {
            lista.innerHTML = '';
            document.getElementById('camposLancamentoLegado').style.display = 'block';
            document.getElementById('kmRodado').required = true;
            document.getElementById('btnSalvarLancamento').textContent = 'Salvar Lançamento';
            if (botaoSalvar) botaoSalvar.disabled = false;
            if (status) status.textContent = `Não há trechos cadastrados na grade para esta linha no dia ${nomeTipoDia}. Use os campos abaixo.`;
            return;
        }

        document.getElementById('camposLancamentoLegado').style.display = 'none';
        document.getElementById('kmRodado').required = false;
        document.getElementById('btnSalvarLancamento').textContent = 'Salvar Lançamentos por Viagem';
        if (botaoSalvar) botaoSalvar.disabled = false;
        if (status) status.textContent = `${trechosLancamento.length} ${trechosLancamento.length === 1 ? 'trecho carregado' : 'trechos carregados'} da grade (${nomeTipoDia}). Clique no trecho para ver o R$ / km.`;
        lista.innerHTML = `<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light"><tr>
                <th>Bloco</th><th>Sentido</th><th>Saída - Chegada</th><th>Rota</th>
                <th>Motorista (qtd.)</th><th>Excesso (R$)</th>
                <th>Comum (qtd.)</th><th>Escolar (qtd.)</th><th>VT (qtd.)</th><th>KM</th>
            </tr></thead><tbody>${trechosLancamento.map(trecho => {
                const id = String(trecho.id);
                const lancamento = lancamentosPorTrecho.get(id) || {};
                const kmValor = lancamento.km_rodado != null ? lancamento.km_rodado : trecho.distancia_km;
                const entrada = (campo, valor) => `<input class="form-control form-control-sm" type="number" min="0" step="0.01" data-campo="${campo}" value="${Number(valor || 0)}" aria-label="${campo} do trecho ${formatarHoraLancamento(trecho.horario_saida)}">`;
                const quantidade = (campo, valor) => `<input class="form-control form-control-sm" type="number" min="0" step="1" data-campo="${campo}" value="${Number(valor || 0)}" aria-label="${campo} do trecho ${formatarHoraLancamento(trecho.horario_saida)}">`;
                const sentido = trecho.ida_volta === 'IDA' ? 'primary' : 'secondary';
                return `<tr class="trecho-linha" role="button" style="cursor:pointer" title="Clique para ver o R$ / km" data-horario-operacao-id="${escaparHtml(id)}" data-lancamento-id="${escaparHtml(lancamento.id || '')}">
                    <th class="text-nowrap">Bloco ${escaparHtml(trecho.tabela)}</th>
                    <td><span class="badge text-bg-${sentido}">${escaparHtml(trecho.ida_volta)}</span></td>
                    <td class="text-nowrap">${escaparHtml(formatarHoraLancamento(trecho.horario_saida))} - ${escaparHtml(formatarHoraLancamento(trecho.horario_chegada))}</td>
                    <td class="small">${escaparHtml(trecho.local_saida || '')} &rarr; ${escaparHtml(trecho.local_chegada || '')}</td>
                    <td>${quantidade('quantidade_motorista', lancamento.quantidade_motorista)}</td>
                    <td>${entrada('valor_excesso', lancamento.valor_excesso)}</td>
                    <td>${quantidade('quantidade_comum', lancamento.quantidade_comum)}</td>
                    <td>${quantidade('quantidade_escolar', lancamento.quantidade_escolar)}</td>
                    <td>${quantidade('quantidade_vt', lancamento.quantidade_vt)}</td>
                    <td>${entrada('km_rodado', kmValor)}</td>
                </tr>
                <tr data-detalhe-de="${escaparHtml(id)}" class="table-light" style="display:none"><td colspan="10"><div class="small text-muted" data-resumo-trecho></div></td></tr>`;
            }).join('')}</tbody></table></div>`;

        [...lista.querySelectorAll('tr[data-horario-operacao-id]')].forEach(atualizarResumoTrecho);

        if (!lista.dataset.trechoAcoes) {
            lista.addEventListener('click', event => {
                if (event.target.closest('input, select, button, a, label')) return;
                const linhaViagem = event.target.closest('tr[data-horario-operacao-id]');
                if (!linhaViagem) return;
                const detalhe = document.querySelector(`#listaViagens tr[data-detalhe-de="${linhaViagem.dataset.horarioOperacaoId}"]`);
                if (!detalhe) return;
                detalhe.style.display = detalhe.style.display === 'none' ? '' : 'none';
            });
            lista.addEventListener('input', event => {
                const linhaViagem = event.target.closest('tr[data-horario-operacao-id]');
                if (linhaViagem) atualizarResumoTrecho(linhaViagem);
            });
            lista.dataset.trechoAcoes = 'true';
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
        document.getElementById('dataOp').addEventListener('change', carregarViagensLancamento);
        document.getElementById('linha').addEventListener('change', carregarViagensLancamento);

        formLancamento.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = e.target.querySelector('button[type="submit"]');
            btnSubmit.disabled = true;

            const vGaragem = document.getElementById('vGaragem').value || 0;
            const vExcesso = document.getElementById('vExcesso').value || 0;
            const comum = document.getElementById('vComum').value || 0;
            const escolar = document.getElementById('vEscolar').value || 0;
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
                quantidade_motorista: parseInt(vGaragem || 0, 10),
                valor_excesso: parseFloat(vExcesso),
                comum: parseFloat(comum),
                escolar: parseFloat(escolar),
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
            if (trechosLancamento.length) {
                const viagens = [...document.querySelectorAll('#listaViagens tbody tr[data-horario-operacao-id]')].map(linhaViagem => {
                    const valores = Object.fromEntries([...linhaViagem.querySelectorAll('[data-campo]')]
                        .map(campo => [campo.dataset.campo, Number(campo.value || 0)]));
                    return { horario_operacao_id: Number(linhaViagem.dataset.horarioOperacaoId), ...valores };
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

                const totalGrupo = numero(itens, 'valor_total');
                const kmGrupo = numero(itens, 'km_rodado');
                const rsPorKm = kmGrupo > 0 ? totalGrupo / kmGrupo : 0;
                const tarifaVtReferencia = tarifasLancamento ? tarifasLancamento.vt : null;
                const corRsPorKm = tarifaVtReferencia !== null
                    ? (rsPorKm >= tarifaVtReferencia ? 'fw-bold text-success' : 'fw-bold text-danger')
                    : '';

                if (operacional) {
                    linhaResumo = `<tr>
                        <td>${dataFormatada}</td><td>${nomeClicavel}</td>
                        <td>${moeda(numero(itens, 'valor_excesso'))}</td>
                        <td>${numero(itens, 'km_rodado').toFixed(2)} km</td><td>${botaoDetalhes}</td>
                    </tr>`;
                } else {
                    linhaResumo = `<tr>
                        <td>${dataFormatada}</td><td>${nomeClicavel}</td>
                        <td>${numero(itens, 'quantidade_motorista')}</td>
                        <td>${moeda(numero(itens, 'valor_garagem'))}</td>
                        <td>${moeda(numero(itens, 'valor_excesso'))}</td><td>${moeda(numero(itens, 'comum'))}</td>
                        <td>${moeda(numero(itens, 'escolar'))}</td>
                        <td>${moeda(numero(itens, 'vt'))}</td><td>${numero(itens, 'km_rodado').toFixed(2)} km</td>
                        <td class="fw-bold text-success">${moeda(totalGrupo)}</td>
                        <td class="${corRsPorKm}">${moeda(rsPorKm)}</td><td>${botaoDetalhes}</td>
                    </tr>`;
                }

                const detalhes = itens.map(item => {
                    const horario = `${formatarHoraLancamento(item.hora_inicio)} - ${formatarHoraLancamento(item.hora_fim)}`;
                    const bloco = escaparHtml(item.tabela ?? '—');
                    const sentido = escaparHtml(item.ida_volta ?? '—');
                    const kmItem = Number(item.km_rodado || 0);
                    const rsPorKmItem = kmItem > 0 ? Number(item.valor_total || 0) / kmItem : 0;
                    const corItem = tarifaVtReferencia !== null
                        ? (rsPorKmItem >= tarifaVtReferencia ? 'text-success' : 'text-danger')
                        : '';
                    const botaoEditar = (operacional || ['Administração', 'Financeiro', 'TI'].includes(setorUsuario))
                        ? `<button class="btn btn-sm btn-outline-primary" type="button" data-editar-lancamento="${escaparHtml(item.id)}">Editar</button>`
                        : '';
                    if (operacional) {
                        return `<tr><td>${escaparHtml(horario)}</td><td>${bloco}</td><td>${sentido}</td><td>${moeda(item.valor_excesso)}</td><td>${kmItem.toFixed(2)} km</td><td>${botaoEditar}</td></tr>`;
                    }
                    return `<tr>
                        <td>${escaparHtml(horario)}</td><td>${bloco}</td><td>${sentido}</td>
                        <td>${Number(item.quantidade_motorista || 0)}</td><td>${moeda(item.valor_garagem)}</td>
                        <td>${moeda(item.valor_excesso)}</td><td>${Number(item.quantidade_comum || 0)}</td><td>${moeda(item.comum)}</td>
                        <td>${Number(item.quantidade_escolar || 0)}</td><td>${moeda(item.escolar)}</td>
                        <td>${Number(item.quantidade_vt || 0)}</td><td>${moeda(item.vt)}</td>
                        <td>${kmItem.toFixed(2)} km</td><td class="${corItem}">${moeda(rsPorKmItem)}</td><td>${botaoEditar}</td>
                    </tr>`;
                }).join('');
                const cabecalhoDetalhes = operacional
                    ? '<tr><th>Horário</th><th>Bloco</th><th>Sentido</th><th>Excesso</th><th>KM</th><th>Ações</th></tr>'
                    : '<tr><th>Horário</th><th>Bloco</th><th>Sentido</th><th>Motorista (qtd.)</th><th>Pagantes (R$)</th><th>Excesso</th><th>Comum qtd.</th><th>Comum R$</th><th>Escolar qtd.</th><th>Escolar R$</th><th>VT qtd.</th><th>VT R$</th><th>KM</th><th>R$ / km</th><th>Ações</th></tr>';
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
            if (!data.escala_id && !data.horario_operacao_id) {
                trechosLancamento = [];
                document.getElementById('listaViagens').innerHTML = '';
                document.getElementById('camposLancamentoLegado').style.display = 'block';
                document.getElementById('kmRodado').required = true;
                document.getElementById('btnSalvarLancamento').textContent = 'Atualizar Lançamento';
            }
            document.getElementById('vGaragem').value = data.quantidade_motorista;
            document.getElementById('vExcesso').value = data.valor_excesso;
            document.getElementById('vComum').value = data.comum || 0;
            document.getElementById('vEscolar').value = data.escolar || 0;
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