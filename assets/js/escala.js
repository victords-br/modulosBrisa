document.addEventListener('DOMContentLoaded', async () => {
    const hasEscalaPage = !!document.getElementById('formEscala') || !!document.getElementById('listaEscalas');

    if (!hasEscalaPage) {
        return;
    }

    if (typeof window.supabaseClient === 'undefined') {
        console.error('Erro crítico: supabaseClient não foi inicializado.');
        return;
    }

    let usuarioLogado = null;
    let escalaEditandoId = null;
    let setorUsuario = '';

    const filtroData = document.getElementById('filtroData');
    const filtroLinha = document.getElementById('filtroLinha');
    const formEscala = document.getElementById('formEscala');
    const modalEscala = document.getElementById('modalEscala');
    const formReplicarEscala = document.getElementById('formReplicarEscala');
    const modalReplicarEscala = document.getElementById('modalReplicarEscala');
    const listaEscalas = document.getElementById('listaEscalas');
    const btnGerarPdfEscala = document.getElementById('btnGerarPdfEscala');
    let escalasCarregadas = [];
    let filtrosCarregados = null;

    if (listaEscalas) {
        listaEscalas.addEventListener('click', event => {
            const botao = event.target.closest('button[data-acao-escala]');
            if (!botao) return;

            if (botao.dataset.acaoEscala === 'editar') {
                window.editarEscala(botao.dataset.id);
            } else if (botao.dataset.acaoEscala === 'excluir') {
                window.excluirEscala(botao.dataset.id);
            }
        });
    }

    async function iniciarEscala() {
        const context = await window.requireModuleAccess('escala');
        if (!context) {
            return;
        }

        usuarioLogado = context.session.user;
        setorUsuario = context.sector;
        const nomeUsuario = context.profile.nome || usuarioLogado.email;
        document.getElementById('infoUsuario').textContent = `${nomeUsuario} - ${setorUsuario}`;

        await carregarLinhas();
        await carregarCarros();
        await carregarMotoristas();
        await carregarEscalas();
    }

    async function carregarLinhas() {
        const { data, error } = await window.supabaseClient
            .from('linhas')
            .select('id, nome')
            .order('nome');

        const selectLinha = document.getElementById('escalaLinhaId');
        const filtroLinhaSelect = document.getElementById('filtroLinha');

        if (error) {
            console.error('Erro ao buscar linhas:', error);
            return;
        }

        if (selectLinha) {
            selectLinha.innerHTML = '<option value="" selected>Carregando linhas...</option>';
            data.forEach(linha => {
                selectLinha.innerHTML += `<option value="${linha.id}">${linha.nome}</option>`;
            });
        }

        if (filtroLinhaSelect) {
            filtroLinhaSelect.innerHTML = '<option value="">Todas as Linhas</option>';
            data.forEach(linha => {
                filtroLinhaSelect.innerHTML += `<option value="${linha.id}">${linha.nome}</option>`;
            });
        }
    }

    async function carregarCarros() {
        const { data, error } = await window.supabaseClient
            .from('carros')
            .select('id, numero_ordem, modelo')
            .order('numero_ordem');

        const selectCarro = document.getElementById('escalaCarroId');

        if (error) {
            console.error('Erro ao buscar carros:', error);
            return;
        }

        if (selectCarro) {
            selectCarro.innerHTML = '<option value="" selected>Carregando carros...</option>';
            data.forEach(carro => {
                const label = carro.modelo ? `${carro.numero_ordem} - ${carro.modelo}` : carro.numero_ordem;
                selectCarro.innerHTML += `<option value="${carro.id}">${label}</option>`;
            });
        }
    }

    async function carregarMotoristas() {
        const { data, error } = await window.supabaseClient
            .from('funcionarios')
            .select('id, nome, matricula, funcao')
            .order('nome');

        const selectMotorista = document.getElementById('escalaMotoristaId');

        if (error) {
            console.error('Erro ao buscar funcionários:', error);
            return;
        }

        if (selectMotorista) {
            selectMotorista.innerHTML = '<option value="" selected>Carregando motoristas...</option>';
            data.forEach(motorista => {
                selectMotorista.innerHTML += `<option value="${motorista.id}">${motorista.nome} (${motorista.matricula})</option>`;
            });
        }
    }

    function formatarData(dataIso) {
        if (!dataIso) return '-';
        const data = new Date(dataIso + 'T00:00:00');
        return isNaN(data.getTime()) ? dataIso : data.toLocaleDateString('pt-BR');
    }

    function formatarHora(hora) {
        if (!hora) return '-';

        const valor = String(hora).trim();
        const formato12Horas = valor.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);

        if (formato12Horas) {
            let horaNumerica = Number(formato12Horas[1]) % 12;
            if (formato12Horas[3].toUpperCase() === 'PM') horaNumerica += 12;
            return `${String(horaNumerica).padStart(2, '0')}:${formato12Horas[2]}`;
        }

        const formato24Horas = valor.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (formato24Horas) {
            return `${formato24Horas[1].padStart(2, '0')}:${formato24Horas[2]}`;
        }

        return valor.substring(0, 5);
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

    function gerarPdfEscala() {
        const dataSelecionada = filtroData?.value || '';
        const linhaSelecionada = filtroLinha?.value || '';

        if (!dataSelecionada) {
            alert('Selecione uma data e aplique o filtro antes de gerar o PDF.');
            return;
        }

        if (!filtrosCarregados || filtrosCarregados.data !== dataSelecionada || filtrosCarregados.linha !== linhaSelecionada) {
            alert('Aplique os filtros selecionados antes de gerar o PDF.');
            return;
        }

        if (escalasCarregadas.length === 0) {
            alert('Não há escalas para a data selecionada.');
            return;
        }

        const paginaImpressao = window.open('escala-impressao.html', '_blank');
        if (!paginaImpressao) {
            alert('Permita a abertura de janelas pop-up para gerar o PDF.');
            return;
        }

        const motoristas = new Set(escalasCarregadas.map(item => item.motorista_id || item.funcionarios?.nome));
        const escalasOrdenadas = [...escalasCarregadas].sort((a, b) => {
            const motoristaA = a.funcionarios?.nome || 'Motorista removido';
            const motoristaB = b.funcionarios?.nome || 'Motorista removido';
            return motoristaA.localeCompare(motoristaB, 'pt-BR', { sensitivity: 'base' })
                || (a.hora_inicio || '').localeCompare(b.hora_inicio || '');
        });
        const nomeLinha = linhaSelecionada
            ? filtroLinha.options[filtroLinha.selectedIndex]?.text || 'Linha selecionada'
            : 'Todas as linhas';
        const dadosImpressao = {
            data: formatarData(dataSelecionada),
            linha: nomeLinha,
            turnos: escalasCarregadas.length,
            motoristas: motoristas.size,
            geradoEm: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
            escalas: escalasOrdenadas.map(item => ({
                horario: `${formatarHora(item.hora_inicio)} - ${formatarHora(item.hora_fim)}`,
                motorista: item.funcionarios?.nome || 'Motorista removido',
                matricula: item.funcionarios?.matricula || '-',
                linha: item.linhas?.nome || 'Linha removida',
                carro: `${item.carros?.numero_ordem || 'Carro removido'}${item.carros?.modelo ? ` · ${item.carros.modelo}` : ''}`,
                trajeto: `${item.local_inicio || 'Não informado'} - ${item.local_final || 'Não informado'}`
            }))
        };

        const mensagemImpressao = { tipo: 'ESCALA_PARA_IMPRESSAO', dados: dadosImpressao };
        const enviarDados = event => {
            if (event.origin !== window.location.origin || event.source !== paginaImpressao) return;

            if (event.data?.tipo === 'ESCALA_IMPRESSAO_PRONTA') {
                paginaImpressao.postMessage(mensagemImpressao, window.location.origin);
            } else if (event.data?.tipo === 'ESCALA_IMPRESSAO_RECEBIDA') {
                window.removeEventListener('message', enviarDados);
                window.clearInterval(intervaloEnvio);
            }
        };

        window.addEventListener('message', enviarDados);
        const intervaloEnvio = window.setInterval(() => {
            if (paginaImpressao.closed) {
                window.removeEventListener('message', enviarDados);
                window.clearInterval(intervaloEnvio);
                return;
            }
            paginaImpressao.postMessage(mensagemImpressao, window.location.origin);
        }, 500);
        paginaImpressao.addEventListener('beforeunload', () => {
            window.removeEventListener('message', enviarDados);
            window.clearInterval(intervaloEnvio);
        }, { once: true });
    }

    function iniciaisDoNome(nome) {
        return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(parte => parte[0]).join('').toLocaleUpperCase('pt-BR') || '?';
    }

    async function carregarEscalas() {
        escalasCarregadas = [];
        filtrosCarregados = null;

        let query = window.supabaseClient
            .from('escalas_trabalho')
            .select('*, linhas(nome), carros(numero_ordem, modelo), funcionarios(nome, matricula)');

        if (filtroData && filtroData.value) {
            query = query.eq('data_escala', filtroData.value);
        }

        if (filtroLinha && filtroLinha.value) {
            query = query.eq('linha_id', filtroLinha.value);
        }

        const { data, error } = await query
            .order('data_escala', { ascending: false })
            .order('hora_inicio', { ascending: true });

        if (error) {
            console.error('Erro ao buscar escalas:', error);
            return;
        }

        escalasCarregadas = data || [];
        filtrosCarregados = {
            data: filtroData?.value || '',
            linha: filtroLinha?.value || ''
        };

        if (!listaEscalas) return;

        listaEscalas.innerHTML = '';

        if (!data || data.length === 0) {
            listaEscalas.innerHTML = '<div class="escala-vazia">Nenhuma escala encontrada para esses filtros.</div>';
            return;
        }

        const gruposMotoristas = new Map();

        data.forEach(item => {
            const motoristaNome = item.funcionarios ? item.funcionarios.nome : 'Motorista removido';
            const chaveMotorista = item.motorista_id || motoristaNome;

            if (!gruposMotoristas.has(chaveMotorista)) {
                gruposMotoristas.set(chaveMotorista, {
                    nome: motoristaNome,
                    matricula: item.funcionarios?.matricula || '-',
                    primeiroHorario: item.hora_inicio || '99:99:99',
                    escalas: []
                });
            }

            const grupoMotorista = gruposMotoristas.get(chaveMotorista);
            grupoMotorista.escalas.push(item);
            if (item.hora_inicio && item.hora_inicio < grupoMotorista.primeiroHorario) {
                grupoMotorista.primeiroHorario = item.hora_inicio;
            }
        });

        const podeAlterar = ['Administração', 'Operacional', 'TI'].includes(setorUsuario);
        const gruposOrdenados = [...gruposMotoristas.values()].sort((a, b) =>
            a.primeiroHorario.localeCompare(b.primeiroHorario) || a.nome.localeCompare(b.nome, 'pt-BR')
        );

        listaEscalas.innerHTML = gruposOrdenados.map(grupo => `
            <section class="escala-grupo-motorista">
                <header class="escala-grupo-cabecalho">
                    <div class="escala-motorista-identidade">
                        <span class="escala-avatar" aria-hidden="true">${escaparHtml(iniciaisDoNome(grupo.nome))}</span>
                        <div>
                            <h3>${escaparHtml(grupo.nome)}</h3>
                            <span>Matrícula ${escaparHtml(grupo.matricula)}</span>
                        </div>
                    </div>
                    <span class="escala-contagem">${grupo.escalas.length} ${grupo.escalas.length === 1 ? 'turno' : 'turnos'}</span>
                </header>
                <div class="escala-turnos">
                    ${grupo.escalas.map(item => {
                        const linhaNome = item.linhas?.nome || 'Linha removida';
                        const carroNome = item.carros?.numero_ordem || 'Carro removido';
                        const modeloCarro = item.carros?.modelo;
                        const botoesAcao = podeAlterar ? `
                            <div class="escala-acoes">
                                <button class="btn btn-sm btn-outline-primary" type="button" data-acao-escala="editar" data-id="${escaparHtml(item.id)}" aria-label="Editar escala de ${escaparHtml(grupo.nome)}">Editar</button>
                                <button class="btn btn-sm btn-outline-danger" type="button" data-acao-escala="excluir" data-id="${escaparHtml(item.id)}" aria-label="Excluir escala de ${escaparHtml(grupo.nome)}">Excluir</button>
                            </div>
                        ` : '';

                        return `
                            <article class="escala-turno">
                                <div class="escala-turno-data">
                                    <span>DATA</span>
                                    <strong>${escaparHtml(formatarData(item.data_escala))}</strong>
                                </div>
                                <div class="escala-turno-horario" aria-label="Das ${escaparHtml(formatarHora(item.hora_inicio))} às ${escaparHtml(formatarHora(item.hora_fim))}">
                                    <strong>${escaparHtml(formatarHora(item.hora_inicio))}</strong>
                                    <span aria-hidden="true">-</span>
                                    <strong>${escaparHtml(formatarHora(item.hora_fim))}</strong>
                                </div>
                                <div class="escala-turno-linha">
                                    <span>LINHA</span>
                                    <strong>${escaparHtml(linhaNome)}</strong>
                                </div>
                                <div class="escala-turno-carro">
                                    <span>CARRO</span>
                                    <strong>${escaparHtml(carroNome)}${modeloCarro ? ` · ${escaparHtml(modeloCarro)}` : ''}</strong>
                                </div>
                                <div class="escala-turno-trajeto">
                                    <span>TRAJETO</span>
                                    <strong>${escaparHtml(item.local_inicio || 'Não informado')} <span aria-hidden="true">→</span> ${escaparHtml(item.local_final || 'Não informado')}</strong>
                                </div>
                                ${botoesAcao}
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `).join('');
    }

    function resetarFormulario() {
        if (formEscala) {
            formEscala.reset();
        }

        escalaEditandoId = null;

        const tituloModal = document.getElementById('tituloModalEscala');
        const btnSalvar = formEscala ? formEscala.querySelector('button[type="submit"]') : null;

        if (tituloModal) {
            tituloModal.textContent = 'Nova Escala de Trabalho';
        }

        if (btnSalvar) {
            btnSalvar.textContent = 'Salvar Escala';
        }
    }

    if (formEscala) {
        formEscala.addEventListener('submit', async (event) => {
            event.preventDefault();

            const dados = {
                data_escala: document.getElementById('escalaData').value,
                linha_id: document.getElementById('escalaLinhaId').value,
                carro_id: document.getElementById('escalaCarroId').value,
                motorista_id: document.getElementById('escalaMotoristaId').value,
                hora_inicio: document.getElementById('escalaInicio').value,
                hora_fim: document.getElementById('escalaFim').value,
                local_inicio: document.getElementById('escalaLocalInicio').value.trim() || null,
                local_final: document.getElementById('escalaLocalFinal').value.trim() || null,
            };

            if (!dados.data_escala || !dados.linha_id || !dados.carro_id || !dados.motorista_id || !dados.hora_inicio || !dados.hora_fim) {
                alert('Preencha todos os campos obrigatórios antes de salvar.');
                return;
            }

            const [inicioHora, inicioMinuto] = dados.hora_inicio.split(':').map(Number);
            const [fimHora, fimMinuto] = dados.hora_fim.split(':').map(Number);
            const inicioMinutos = (inicioHora * 60) + inicioMinuto;
            const fimMinutos = (fimHora * 60) + fimMinuto;

            if (fimMinutos <= inicioMinutos) {
                alert('A hora final deve ser maior que a hora inicial.');
                return;
            }

            const dadosEscala = {
                ...dados,
                linha_id: Number(dados.linha_id)
            };

            let result;

            if (escalaEditandoId) {
                result = await window.supabaseClient
                    .from('escalas_trabalho')
                    .update(dadosEscala)
                    .eq('id', escalaEditandoId);
            } else {
                result = await window.supabaseClient
                    .from('escalas_trabalho')
                    .insert({ ...dadosEscala, user_id: usuarioLogado.id });
            }

            if (result.error) {
                alert('Erro ao salvar escala: ' + result.error.message);
                return;
            }

            const modalInstance = bootstrap.Modal.getInstance(modalEscala);
            if (modalInstance) {
                modalInstance.hide();
            }

            resetarFormulario();
            await carregarEscalas();
        });
    }

    window.editarEscala = async function(id) {
        if (!['Administração', 'Operacional', 'TI'].includes(setorUsuario)) {
            alert('Seu setor não tem permissão para alterar escalas.');
            return;
        }

        const { data, error } = await window.supabaseClient
            .from('escalas_trabalho')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('Erro ao carregar escala para edição:', error);
            alert('Não foi possível carregar esta escala. Você só pode editar escalas criadas por você.');
            return;
        }

        escalaEditandoId = id;

        document.getElementById('escalaData').value = data.data_escala;
        document.getElementById('escalaLinhaId').value = data.linha_id || '';
        document.getElementById('escalaCarroId').value = data.carro_id || '';
        document.getElementById('escalaMotoristaId').value = data.motorista_id || '';
        document.getElementById('escalaInicio').value = data.hora_inicio || '';
        document.getElementById('escalaFim').value = data.hora_fim || '';
        document.getElementById('escalaLocalInicio').value = data.local_inicio || '';
        document.getElementById('escalaLocalFinal').value = data.local_final || '';

        const tituloModal = document.getElementById('tituloModalEscala');
        const btnSalvar = formEscala ? formEscala.querySelector('button[type="submit"]') : null;

        if (tituloModal) {
            tituloModal.textContent = 'Editar Escala de Trabalho';
        }

        if (btnSalvar) {
            btnSalvar.textContent = 'Atualizar Escala';
        }

        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEscala);
        modalInstance.show();
    };

    window.excluirEscala = async function(id) {
        if (!['Administração', 'Operacional', 'TI'].includes(setorUsuario)) {
            alert('Seu setor não tem permissão para excluir escalas.');
            return;
        }

        const confirmar = window.confirm('Deseja excluir esta escala?');
        if (!confirmar) {
            return;
        }

        const { error } = await window.supabaseClient
            .from('escalas_trabalho')
            .delete()
            .eq('id', id);

        if (error) {
            alert('Erro ao excluir escala: ' + error.message);
            return;
        }

        await carregarEscalas();
    };

    if (formReplicarEscala) {
        formReplicarEscala.addEventListener('submit', async event => {
            event.preventDefault();

            const dataOrigem = document.getElementById('dataOrigemReplicar').value;
            const dataDestino = document.getElementById('dataDestinoReplicar').value;
            const button = document.getElementById('btnConfirmarReplicacao');

            if (!dataOrigem || !dataDestino) {
                alert('Selecione as datas de origem e destino.');
                return;
            }

            if (dataOrigem === dataDestino) {
                alert('A data de destino precisa ser diferente da data de origem.');
                return;
            }

            button.disabled = true;
            button.textContent = 'Copiando...';

            try {
                const campos = 'linha_id, carro_id, motorista_id, hora_inicio, hora_fim, local_inicio, local_final';
                const { data: escalasOrigem, error: erroOrigem } = await window.supabaseClient
                    .from('escalas_trabalho')
                    .select(campos)
                    .eq('data_escala', dataOrigem);

                if (erroOrigem) throw erroOrigem;
                if (!escalasOrigem || escalasOrigem.length === 0) {
                    alert('Não há escalas cadastradas na data de origem.');
                    return;
                }

                const { data: escalasDestino, error: erroDestino } = await window.supabaseClient
                    .from('escalas_trabalho')
                    .select(campos)
                    .eq('data_escala', dataDestino);

                if (erroDestino) throw erroDestino;

                const chaveEscala = escala => JSON.stringify([
                    escala.linha_id,
                    escala.carro_id,
                    escala.motorista_id,
                    escala.hora_inicio,
                    escala.hora_fim,
                    escala.local_inicio,
                    escala.local_final
                ]);
                const chavesDestino = new Set((escalasDestino || []).map(chaveEscala));
                const paraInserir = escalasOrigem
                    .filter(escala => !chavesDestino.has(chaveEscala(escala)))
                    .map(escala => ({
                        ...escala,
                        data_escala: dataDestino,
                        user_id: usuarioLogado.id
                    }));
                const ignoradas = escalasOrigem.length - paraInserir.length;

                if (paraInserir.length > 0) {
                    const { error: erroInsercao } = await window.supabaseClient
                        .from('escalas_trabalho')
                        .insert(paraInserir);
                    if (erroInsercao) throw erroInsercao;
                }

                const modalInstance = bootstrap.Modal.getInstance(modalReplicarEscala);
                if (modalInstance) modalInstance.hide();

                if (filtroData) filtroData.value = dataDestino;
                if (filtroLinha) filtroLinha.value = '';
                await carregarEscalas();
                alert(`${paraInserir.length} escala(s) replicada(s). ${ignoradas} duplicata(s) ignorada(s).`);
                formReplicarEscala.reset();
            } catch (error) {
                alert('Erro ao replicar escalas: ' + error.message);
            } finally {
                button.disabled = false;
                button.textContent = 'Replicar escalas';
            }
        });
    }

    const btnFiltrarEscala = document.getElementById('btnFiltrarEscala');
    if (btnFiltrarEscala) {
        btnFiltrarEscala.addEventListener('click', carregarEscalas);
    }

    if (btnGerarPdfEscala) {
        btnGerarPdfEscala.addEventListener('click', gerarPdfEscala);
    }

    const botaoNovaEscala = document.querySelector('[data-bs-target="#modalEscala"]');
    if (botaoNovaEscala) {
        botaoNovaEscala.addEventListener('click', resetarFormulario);
    }

    iniciarEscala();
});
