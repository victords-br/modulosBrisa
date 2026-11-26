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
    const filtroCodigoEscala = document.getElementById('filtroCodigoEscala');
    const formEscala = document.getElementById('formEscala');
    const modalEscala = document.getElementById('modalEscala');
    const formEscalaOperacional = document.getElementById('formEscalaOperacional');
    const modalEscalaOperacional = document.getElementById('modalEscalaOperacional');
    const formReplicarEscala = document.getElementById('formReplicarEscala');
    const modalReplicarEscala = document.getElementById('modalReplicarEscala');
    const listaEscalas = document.getElementById('listaEscalas');
    const btnGerarPdfEscala = document.getElementById('btnGerarPdfEscala');
    let escalasCarregadas = [];
    let filtrosCarregados = null;
    let motoristasCarregados = [];
    let escalasOperacionaisCarregadas = [];
    let regrasFolgaCarregadas = [];
    let folgasCarregadas = [];
    let folgasDiaCarregadas = [];
    let erroFolgasDia = null;
    let substituicoesCarregadas = [];

    if (listaEscalas) {
        listaEscalas.addEventListener('click', event => {
            const botao = event.target.closest('button[data-acao-escala]');
            const acaoFolga = event.target.closest('button[data-acao-folga]');
            if (botao?.dataset.acaoEscala === 'editar') {
                window.editarEscala(botao.dataset.id);
            } else if (botao?.dataset.acaoEscala === 'excluir') {
                window.excluirEscala(botao.dataset.id);
            } else if (botao?.dataset.acaoEscala === 'editar-operacional') {
                editarEscalaOperacional(botao.dataset.id);
            } else if (acaoFolga?.dataset.acaoFolga === 'excluir') {
                excluirExcecaoFolga(acaoFolga.dataset.id);
            } else if (botao?.dataset.acaoSubstituicao === 'excluir') {
                excluirSubstituicao(botao.dataset.id);
            }
        });
        listaEscalas.addEventListener('submit', async event => {
            const formFolga = event.target.closest('form[data-form-folga]');
            const formSubstituicao = event.target.closest('form[data-form-substituicao]');
            if (!formFolga && !formSubstituicao) return;
            event.preventDefault();
            const form = formFolga || formSubstituicao;
            const escalaId = form.dataset.formFolga || form.dataset.formSubstituicao;
            const dateInput = form.querySelector('input[type="date"]');
            const escala = escalasOperacionaisCarregadas.find(item => item.id === escalaId);
            if (!dateInput.value || !escala || dateInput.value < escala.inicio_vigencia || (escala.fim_vigencia && dateInput.value > escala.fim_vigencia)) {
                alert('A data informada deve estar dentro da vigência da escala.');
                return;
            }
            const isSubstituicao = Boolean(formSubstituicao);
            const substitutoInformado = form.querySelector('select').value;
            if (isSubstituicao && escalaEstaEmFolga(escalaId, dateInput.value)) {
                if (!escala.motorista_substituto_fixo_id) {
                    alert('Configure o substituto fixo da escala antes de registrar uma substituição em dia de folga.');
                    return;
                }
                if (substitutoInformado !== escala.motorista_substituto_fixo_id) {
                    alert('Em dia de folga, deve ser usado o substituto fixo configurado para a escala.');
                    return;
                }
            }
            const valores = isSubstituicao
                ? {
                    escala_operacional_id: escalaId,
                    data_substituicao: dateInput.value,
                    motorista_substituto_id: substitutoInformado,
                    user_id: usuarioLogado.id
                }
                : {
                    escala_operacional_id: escalaId,
                    data_folga: dateInput.value,
                    tipo: form.querySelector('select').value,
                    user_id: usuarioLogado.id
                };
            const tabela = isSubstituicao ? 'substituicoes_escalas' : 'folgas_escalas';
            const conflito = isSubstituicao
                ? 'escala_operacional_id,data_substituicao'
                : 'escala_operacional_id,data_folga';
            const { error } = await window.supabaseClient.from(tabela).upsert(valores, { onConflict: conflito });
            if (error) {
                alert(`Não foi possível registrar ${isSubstituicao ? 'a substituição' : 'a exceção'}: ${error.message}`);
                return;
            }
            await carregarEscalas();
        });
    }

    function resetarFormularioEscalaOperacional() {
        formEscalaOperacional.reset();
        document.querySelectorAll('#motoristaSubstitutoFixoEscala option').forEach(option => {
            option.disabled = false;
        });
        document.getElementById('escalaOperacionalIdEdicao').value = '';
        document.getElementById('tituloModalEscalaOperacional').textContent = 'Nova escala operacional';
        formEscalaOperacional.querySelector('button[type="submit"]').textContent = 'Salvar escala';
    }

    function editarEscalaOperacional(id) {
        if (!['Administração', 'Operacional', 'TI'].includes(setorUsuario)) {
            alert('Seu setor não tem permissão para alterar escalas.');
            return;
        }
        const escala = escalasOperacionaisCarregadas.find(item => item.id === id);
        if (!escala) return;
        document.getElementById('escalaOperacionalIdEdicao').value = escala.id;
        document.getElementById('codigoEscalaOperacional').value = escala.codigo;
        document.getElementById('motoristaTitularEscala').value = escala.motorista_titular_id;
        document.getElementById('motoristaSubstitutoFixoEscala').value = escala.motorista_substituto_fixo_id || '';
        document.getElementById('motoristaTitularEscala').dispatchEvent(new Event('change'));
        document.getElementById('regraFolgaEscala').value = escala.regra_folga_id || '';
        document.getElementById('inicioVigenciaEscala').value = escala.inicio_vigencia;
        document.getElementById('fimVigenciaEscala').value = escala.fim_vigencia || '';
        document.getElementById('localBaseEscala').value = escala.local_base || '';
        document.getElementById('observacaoEscala').value = escala.observacao || '';
        document.getElementById('tituloModalEscalaOperacional').textContent = `Editar escala ${escala.codigo}`;
        formEscalaOperacional.querySelector('button[type="submit"]').textContent = 'Atualizar escala';
        bootstrap.Modal.getOrCreateInstance(modalEscalaOperacional).show();
    }

    if (formEscalaOperacional) {
        formEscalaOperacional.addEventListener('submit', async event => {
            event.preventDefault();
            const codigo = document.getElementById('codigoEscalaOperacional').value.trim().toUpperCase();
            const inicio = document.getElementById('inicioVigenciaEscala').value;
            const fim = document.getElementById('fimVigenciaEscala').value || null;
            if (!/^\d{4}\.\d{2}[A-Z]?$/.test(codigo)) {
                alert('Use o formato 0022.01 ou 0022.01A para o código.');
                return;
            }
            if (fim && fim < inicio) {
                alert('O fim da vigência não pode ser anterior ao início.');
                return;
            }

            const id = document.getElementById('escalaOperacionalIdEdicao').value;
            const payload = {
                codigo,
                motorista_titular_id: document.getElementById('motoristaTitularEscala').value,
                motorista_substituto_fixo_id: document.getElementById('motoristaSubstitutoFixoEscala').value || null,
                regra_folga_id: document.getElementById('regraFolgaEscala').value || null,
                inicio_vigencia: inicio,
                fim_vigencia: fim,
                local_base: document.getElementById('localBaseEscala').value.trim() || null,
                observacao: document.getElementById('observacaoEscala').value.trim() || null
            };
            const submit = formEscalaOperacional.querySelector('button[type="submit"]');
            submit.disabled = true;
            try {
                const request = id
                    ? window.supabaseClient.from('escalas_operacionais').update(payload).eq('id', id)
                    : window.supabaseClient.from('escalas_operacionais').insert({ ...payload, user_id: usuarioLogado.id });
                const { error } = await request;
                if (error) throw error;
                bootstrap.Modal.getInstance(modalEscalaOperacional)?.hide();
                resetarFormularioEscalaOperacional();
                await carregarEscalasOperacionais();
                await carregarEscalas();
            } catch (error) {
                alert(`Não foi possível salvar a escala: ${error.message}`);
            } finally {
                submit.disabled = false;
            }
        });
    }

    async function excluirExcecaoFolga(id) {
        if (!['Administração', 'Operacional', 'TI'].includes(setorUsuario)) return;
        if (!window.confirm('Remover esta exceção? O ciclo padrão voltará a determinar o dia.')) return;
        const { error } = await window.supabaseClient.from('folgas_escalas').delete().eq('id', id);
        if (error) {
            alert(`Não foi possível remover a exceção: ${error.message}`);
            return;
        }
        await carregarEscalas();
    }

    async function excluirSubstituicao(id) {
        if (!['Administração', 'Operacional', 'TI'].includes(setorUsuario)) return;
        if (!window.confirm('Remover esta substituição? Nas folgas, a cobertura voltará ao substituto fixo ou ficará em branco se ele estiver indisponível.')) return;
        const { error } = await window.supabaseClient.from('substituicoes_escalas').delete().eq('id', id);
        if (error) {
            alert(`Não foi possível remover a substituição: ${error.message}`);
            return;
        }
        await carregarEscalas();
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
        await carregarRegrasFolga();
        await carregarEscalasOperacionais();
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
            selectLinha.innerHTML = '<option value="" selected>Selecione a linha...</option>' + data.map(linha =>
                `<option value="${linha.id}">${escaparHtml(linha.nome)}</option>`
            ).join('');
        }

        if (filtroLinhaSelect) {
            filtroLinhaSelect.innerHTML = '<option value="">Todas as Linhas</option>';
            filtroLinhaSelect.innerHTML += data.map(linha =>
                `<option value="${linha.id}">${escaparHtml(linha.nome)}</option>`
            ).join('');
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
            selectCarro.innerHTML = '<option value="" selected>Selecione o carro...</option>' + data.map(carro => {
                const label = carro.modelo ? `${carro.numero_ordem} - ${carro.modelo}` : carro.numero_ordem;
                return `<option value="${carro.id}">${escaparHtml(label)}</option>`;
            }).join('');
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

        motoristasCarregados = data || [];
        if (selectMotorista) {
            selectMotorista.innerHTML = '<option value="" selected>Selecione o motorista...</option>' + motoristasCarregados.map(motorista =>
                `<option value="${motorista.id}">${escaparHtml(motorista.nome)} (${escaparHtml(motorista.matricula)})</option>`
            ).join('');
        }

        const selectTitular = document.getElementById('motoristaTitularEscala');
        const opcoesMotoristas = motoristasCarregados.map(motorista =>
            `<option value="${motorista.id}">${escaparHtml(motorista.nome)} (${escaparHtml(motorista.matricula)})</option>`
        ).join('');
        if (selectTitular) selectTitular.innerHTML = '<option value="">Selecione o motorista...</option>' + opcoesMotoristas;

        const selectSubstitutoFixo = document.getElementById('motoristaSubstitutoFixoEscala');
        if (selectSubstitutoFixo) {
            selectSubstitutoFixo.innerHTML = '<option value="">Selecione o substituto...</option>' + opcoesMotoristas;
            selectTitular?.addEventListener('change', () => {
                const titularId = selectTitular.value;
                [...selectSubstitutoFixo.options].forEach(option => {
                    option.disabled = Boolean(titularId && option.value === titularId);
                    if (option.value === titularId && option.selected) selectSubstitutoFixo.value = '';
                });
            });
        }
    }

    async function carregarRegrasFolga() {
        const { data, error } = await window.supabaseClient
            .from('regras_folga_escalas')
            .select('id, codigo, nome, padrao_ciclo, ativa')
            .order('codigo');
        if (error) {
            console.error('Erro ao carregar regras de folga:', error);
            return;
        }
        regrasFolgaCarregadas = data || [];
        const select = document.getElementById('regraFolgaEscala');
        if (select) select.innerHTML = '<option value="">Sem regra automática</option>' + regrasFolgaCarregadas.map(regra =>
            `<option value="${regra.id}" ${regra.ativa ? '' : 'disabled'}>${escaparHtml(regra.codigo)} — ${escaparHtml(regra.nome)}${regra.ativa ? '' : ' (inativa)'}</option>`
        ).join('');
    }

    async function carregarEscalasOperacionais() {
        const { data, error } = await window.supabaseClient
            .from('escalas_operacionais')
            .select('id, codigo, motorista_titular_id, motorista_substituto_fixo_id, regra_folga_id, inicio_vigencia, fim_vigencia, local_base, observacao')
            .order('codigo');
        if (error) {
            console.error('Erro ao carregar escalas operacionais:', error);
            if (listaEscalas) {
                listaEscalas.innerHTML = `<div class="alert alert-danger">Não foi possível carregar as escalas por código. Confira se as migrações escalas_operacionais.sql, escalas_substituto_fixo.sql e escalas_folgas_automaticas.sql foram aplicadas: ${escaparHtml(error.message)}</div>`;
            }
            return;
        }
        escalasOperacionaisCarregadas = data || [];
        const select = document.getElementById('escalaOperacionalId');
        if (select) {
            select.innerHTML = '<option value="">Sem escala vinculada (registro antigo)</option>' + escalasOperacionaisCarregadas.map(escala =>
                `<option value="${escala.id}">${escaparHtml(escala.codigo)}</option>`
            ).join('');
        }
    }

    function formatarData(dataIso) {
        if (!dataIso) return '-';
        const data = new Date(dataIso + 'T00:00:00');
        return isNaN(data.getTime()) ? dataIso : data.toLocaleDateString('pt-BR');
    }

    function escalaEstaEmFolga(escalaId, dataIso) {
        const escala = escalasOperacionaisCarregadas.find(item => item.id === escalaId);
        if (!escala || !dataIso || dataIso < escala.inicio_vigencia || (escala.fim_vigencia && dataIso > escala.fim_vigencia)) {
            return false;
        }

        const excecao = folgasCarregadas.find(item =>
            item.escala_operacional_id === escalaId && item.data_folga === dataIso
        );
        if (excecao) return excecao.tipo === 'folga';

        const regra = regrasFolgaCarregadas.find(item => item.id === escala.regra_folga_id);
        if (!regra?.padrao_ciclo) return false;

        const inicio = Date.parse(`${escala.inicio_vigencia}T00:00:00Z`);
        const data = Date.parse(`${dataIso}T00:00:00Z`);
        const diasDesdeInicio = Math.floor((data - inicio) / 86400000);
        return regra.padrao_ciclo[diasDesdeInicio % regra.padrao_ciclo.length] === 'F';
    }

    function atualizarAvisoFolga() {
        const aviso = document.getElementById('avisoFolgaEscala');
        if (!aviso) return;
        const escalaId = document.getElementById('escalaOperacionalId')?.value;
        const data = document.getElementById('escalaData')?.value;
        const escala = escalasOperacionaisCarregadas.find(item => item.id === escalaId);
        if (!escalaId || !data || !escalaEstaEmFolga(escalaId, data)) {
            aviso.textContent = '';
            aviso.className = 'form-text';
            return;
        }

        const substituto = motoristasCarregados.find(item => item.id === escala.motorista_substituto_fixo_id);
        aviso.textContent = substituto
            ? `Folga prevista. ${substituto.nome} cobrirá se estiver livre; se estiver em outra escala no dia, a viagem ficará como "Escala em branco".`
            : 'Folga prevista sem substituto fixo. A cobertura ficará como "Escala em branco" até ser definida.';
        aviso.className = substituto ? 'form-text text-warning-emphasis' : 'form-text text-danger';
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

    function configurarCampoHora(campo) {
        campo.addEventListener('input', () => {
            const digitos = campo.value.replace(/\D/g, '').slice(0, 4);
            campo.value = digitos.length > 2
                ? `${digitos.slice(0, 2)}:${digitos.slice(2)}`
                : digitos;
        });
    }

    function terminaNoDiaSeguinte(horaInicio, horaFim) {
        return Boolean(horaInicio && horaFim && formatarHora(horaFim) < formatarHora(horaInicio));
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

        const codigoSelecionado = filtroCodigoEscala?.value.trim().toLocaleUpperCase('pt-BR') || '';
        if (!filtrosCarregados || filtrosCarregados.data !== dataSelecionada || filtrosCarregados.linha !== linhaSelecionada || filtrosCarregados.codigo !== codigoSelecionado) {
            alert('Aplique os filtros selecionados antes de gerar o PDF.');
            return;
        }

        if (escalasCarregadas.length === 0 && folgasDiaCarregadas.length === 0) {
            alert('Não há escalas para a data selecionada.');
            return;
        }

        const paginaImpressao = window.open('escala-impressao.html', '_blank');
        if (!paginaImpressao) {
            alert('Permita a abertura de janelas pop-up para gerar o PDF.');
            return;
        }

        const motoristas = new Set(escalasCarregadas
            .filter(item => !item.escala_em_branco)
            .map(item => item.motorista_substituto?.id || item.motorista_id || item.funcionarios?.nome));
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
            turnos: escalasCarregadas.filter(item => !item.escala_em_branco).length,
            motoristas: motoristas.size,
            folgas: folgasDiaCarregadas.length,
            geradoEm: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
            escalas: escalasOrdenadas.map(item => ({
                horario: `${formatarHora(item.hora_inicio)} - ${formatarHora(item.hora_fim)}${terminaNoDiaSeguinte(item.hora_inicio, item.hora_fim) ? ' (+1 dia)' : ''}`,
                motorista: item.escala_em_branco
                    ? 'Escala em branco'
                    : item.motorista_substituto
                    ? `${item.funcionarios?.nome || 'Titular'} / ${item.motorista_substituto.nome} (substituto)`
                    : item.funcionarios?.nome || 'Motorista removido',
                matricula: item.escala_em_branco ? '-' : item.funcionarios?.matricula || '-',
                codigoEscala: escalasOperacionaisCarregadas.find(escala => escala.id === item.escala_operacional_id)?.codigo || 'Sem código',
                linha: item.linhas?.nome || 'Linha removida',
                carro: `${item.carros?.numero_ordem || 'Carro removido'}${item.carros?.modelo ? ` · ${item.carros.modelo}` : ''}`,
                trajeto: `${item.local_inicio || 'Não informado'} - ${item.local_final || 'Não informado'}`
            })),
            folgas: [...folgasDiaCarregadas]
                .sort((a, b) => (a.local_base || '').localeCompare(b.local_base || '', 'pt-BR')
                    || a.motorista_nome.localeCompare(b.motorista_nome, 'pt-BR'))
                .map(item => ({
                    local: item.local_base || 'Local não informado',
                    codigo: item.codigo,
                    motorista: item.motorista_nome,
                    matricula: item.matricula || '-',
                    substituto: item.substituto_disponivel ? item.substituto_nome : '',
                    situacao: item.substituto_disponivel
                        ? 'Substituto disponível'
                        : 'Escala em branco'
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

        const codigoFiltro = filtroCodigoEscala?.value.trim().toLocaleUpperCase('pt-BR') || '';
        const escalasVisiveis = codigoFiltro
            ? escalasOperacionaisCarregadas.filter(escala => escala.codigo.toLocaleUpperCase('pt-BR').includes(codigoFiltro))
            : escalasOperacionaisCarregadas;
        const idsEscalasVisiveis = escalasVisiveis.map(escala => escala.id);
        const motoristaPorId = new Map(motoristasCarregados.map(motorista => [motorista.id, motorista]));

        let query = window.supabaseClient
            .from('escalas_trabalho')
            .select('*, linhas(nome), carros(numero_ordem, modelo)');

        if (filtroData && filtroData.value) {
            query = query.eq('data_escala', filtroData.value);
        }

        if (filtroLinha && filtroLinha.value) {
            query = query.eq('linha_id', filtroLinha.value);
        }

        if (codigoFiltro) {
            if (idsEscalasVisiveis.length === 0) {
                escalasCarregadas = [];
            } else {
                query = query.in('escala_operacional_id', idsEscalasVisiveis);
            }
        }

        let data = [];
        if (!codigoFiltro || idsEscalasVisiveis.length > 0) {
            const resultado = await query
                .order('data_escala', { ascending: false })
                .order('hora_inicio', { ascending: true });
            if (resultado.error) {
                console.error('Erro ao buscar viagens da escala:', resultado.error);
                listaEscalas.innerHTML = `<div class="alert alert-danger">Não foi possível carregar as viagens: ${escaparHtml(resultado.error.message)}</div>`;
                return;
            }
            data = resultado.data || [];
        }

        substituicoesCarregadas = [];
        if (idsEscalasVisiveis.length) {
            const resultadoSubstituicoes = await window.supabaseClient
                .from('substituicoes_escalas')
                .select('id, escala_operacional_id, data_substituicao, motorista_substituto_id, observacao')
                .in('escala_operacional_id', idsEscalasVisiveis);
            if (resultadoSubstituicoes.error) {
                console.error('Erro ao carregar substituições:', resultadoSubstituicoes.error);
                listaEscalas.innerHTML = `<div class="alert alert-danger">Não foi possível carregar as substituições por dia: ${escaparHtml(resultadoSubstituicoes.error.message)}</div>`;
                return;
            }
            substituicoesCarregadas = resultadoSubstituicoes.data || [];
        }

        const substituicaoPorEscalaData = new Map(substituicoesCarregadas.map(item => [
            `${item.escala_operacional_id}:${item.data_substituicao}`,
            item
        ]));
        data.forEach(item => {
            item.funcionarios = motoristaPorId.get(item.motorista_id) || null;
            const substituicao = substituicaoPorEscalaData.get(`${item.escala_operacional_id}:${item.data_escala}`);
            item.motorista_substituto = motoristaPorId.get(
                item.motorista_substituto_id || substituicao?.motorista_substituto_id
            ) || null;
        });

        escalasCarregadas = data || [];
        filtrosCarregados = {
            data: filtroData?.value || '',
            linha: filtroLinha?.value || '',
            codigo: codigoFiltro
        };

        if (!listaEscalas) return;

        folgasCarregadas = [];
        const idsTodasEscalas = escalasOperacionaisCarregadas.map(escala => escala.id);
        if (idsTodasEscalas.length) {
            const resultadoFolgas = await window.supabaseClient
                .from('folgas_escalas')
                .select('id, escala_operacional_id, data_folga, tipo, observacao')
                .in('escala_operacional_id', idsTodasEscalas);
            if (resultadoFolgas.error) {
                console.error('Erro ao carregar exceções de folga:', resultadoFolgas.error);
                listaEscalas.innerHTML = `<div class="alert alert-danger">Não foi possível carregar as exceções de folga: ${escaparHtml(resultadoFolgas.error.message)}</div>`;
                return;
            }
            folgasCarregadas = resultadoFolgas.data || [];
        }

        folgasDiaCarregadas = [];
        erroFolgasDia = null;
        if (filtroData?.value) {
            const resultadoFolgasDia = await window.supabaseClient.rpc('listar_folgas_operacionais', {
                p_data: filtroData.value
            });
            if (resultadoFolgasDia.error) {
                console.error('Erro ao carregar folgas automáticas:', resultadoFolgasDia.error);
                erroFolgasDia = resultadoFolgasDia.error.message;
            } else {
                folgasDiaCarregadas = resultadoFolgasDia.data || [];
            }
        }

        const podeAlterar = ['Administração', 'Operacional', 'TI'].includes(setorUsuario);
        const regraPorId = new Map(regrasFolgaCarregadas.map(regra => [regra.id, regra]));
        const folgasPorEscala = new Map();
        folgasCarregadas.forEach(folga => {
            if (!folgasPorEscala.has(folga.escala_operacional_id)) folgasPorEscala.set(folga.escala_operacional_id, new Map());
            folgasPorEscala.get(folga.escala_operacional_id).set(folga.data_folga, folga);
        });

        function gerarDatasFolga(escala) {
            const regra = regraPorId.get(escala.regra_folga_id);
            if (!regra) return [];
            const excecoes = folgasPorEscala.get(escala.id) || new Map();
            const hoje = new Date();
            const inicio = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
            const ancora = new Date(`${escala.inicio_vigencia}T00:00:00Z`);
            const fimVigencia = escala.fim_vigencia ? new Date(`${escala.fim_vigencia}T00:00:00Z`) : null;
            const padrao = regra.padrao_ciclo;
            const datas = [];
            for (let offset = 0; offset < 56; offset += 1) {
                const dia = new Date(inicio.getTime() + offset * 86400000);
                const dataIso = dia.toISOString().slice(0, 10);
                if (dia < ancora || (fimVigencia && dia > fimVigencia)) continue;
                const cicloOffset = Math.floor((dia.getTime() - ancora.getTime()) / 86400000) % padrao.length;
                const excecao = excecoes.get(dataIso);
                const folga = excecao ? excecao.tipo === 'folga' : padrao[cicloOffset] === 'F';
                if (folga) datas.push({ data: dataIso, excecao });
            }
            return datas;
        }

        function renderizarViagem(item, nomeGrupo) {
            const linhaNome = item.linhas?.nome || 'Linha removida';
            const carroNome = item.carros?.numero_ordem || 'Carro removido';
            const modeloCarro = item.carros?.modelo;
            const substituto = item.motorista_substituto?.nome;
            const escalaEmBranco = Boolean(item.escala_em_branco);
            const botoesAcao = podeAlterar ? `
                <div class="escala-acoes">
                    <button class="btn btn-sm btn-outline-primary" type="button" data-acao-escala="editar" data-id="${escaparHtml(item.id)}" aria-label="Editar viagem de ${escaparHtml(nomeGrupo)}">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" type="button" data-acao-escala="excluir" data-id="${escaparHtml(item.id)}" aria-label="Excluir viagem de ${escaparHtml(nomeGrupo)}">Excluir</button>
                </div>
            ` : '';

            return `<article class="escala-turno">
                <div class="escala-turno-dados">
                    <div class="escala-turno-data"><span>DATA</span><strong>${escaparHtml(formatarData(item.data_escala))}</strong></div>
                    <div class="escala-turno-horario" aria-label="Das ${escaparHtml(formatarHora(item.hora_inicio))} às ${escaparHtml(formatarHora(item.hora_fim))}${terminaNoDiaSeguinte(item.hora_inicio, item.hora_fim) ? ' do dia seguinte' : ''}">
                        <strong>${escaparHtml(formatarHora(item.hora_inicio))}</strong><span aria-hidden="true">-</span>
                        <strong>${escaparHtml(formatarHora(item.hora_fim))}${terminaNoDiaSeguinte(item.hora_inicio, item.hora_fim) ? ' (+1 dia)' : ''}</strong>
                    </div>
                    <div class="escala-turno-linha"><span>LINHA</span><strong>${escaparHtml(linhaNome)}</strong></div>
                    <div class="escala-turno-carro"><span>CARRO</span><strong>${escaparHtml(carroNome)}${modeloCarro ? ` · ${escaparHtml(modeloCarro)}` : ''}</strong></div>
                    <div class="escala-turno-trajeto"><span>TRAJETO</span><strong>${escaparHtml(item.local_inicio || 'Não informado')} <span aria-hidden="true">→</span> ${escaparHtml(item.local_final || 'Não informado')}</strong></div>
                </div>
                ${(substituto || escalaEmBranco || botoesAcao) ? `<div class="escala-turno-rodape">
                    ${substituto ? `<div class="escala-substituto"><span>Substituto do dia</span><strong>${escaparHtml(substituto)}</strong></div>` : ''}
                    ${escalaEmBranco ? '<div class="escala-vaga-alerta" role="status">Escala em branco</div>' : ''}
                    ${botoesAcao}
                </div>` : ''}
            </article>`;
        }

        function renderizarPainelFolgas() {
            if (!filtroData?.value) {
                return `<section class="folgas-dia-painel">
                    <div><h3>Folgas do dia</h3><p>Selecione uma data para reunir os motoristas de folga por local-base.</p></div>
                </section>`;
            }

            if (erroFolgasDia) {
                return `<section class="folgas-dia-painel folgas-dia-erro">
                    <div><h3>Folgas do dia · ${escaparHtml(formatarData(filtroData.value))}</h3>
                    <p>Não foi possível carregar a lista automática. Confira se <code>escalas_folgas_automaticas.sql</code> foi aplicada.</p></div>
                </section>`;
            }

            const locais = new Map();
            folgasDiaCarregadas.forEach(item => {
                const local = item.local_base?.trim() || 'Local não informado';
                if (!locais.has(local)) locais.set(local, []);
                locais.get(local).push(item);
            });

            const conteudo = locais.size
                ? [...locais.entries()].map(([local, itens]) => `
                    <article class="folgas-dia-local">
                        <h4>${escaparHtml(local)}</h4>
                        <ul>${itens.map(item => {
                            const status = item.substituto_disponivel
                                ? `<span class="folga-status-ok">Substituto disponível · ${escaparHtml(item.substituto_nome)}</span>`
                                : '<span class="folga-status-vazia">Escala em branco</span>';
                            return `<li><div><strong>${escaparHtml(item.codigo)}</strong><span>${escaparHtml(item.motorista_nome)} · Matrícula ${escaparHtml(item.matricula || '-')}</span></div>${status}</li>`;
                        }).join('')}</ul>
                    </article>`).join('')
                : '<p class="folgas-dia-sem-registros">Nenhum motorista está de folga nesta data.</p>';

            return `<section class="folgas-dia-painel">
                <header><div><h3>Folgas do dia · ${escaparHtml(formatarData(filtroData.value))}</h3>
                <p>${folgasDiaCarregadas.length} motorista(s) agrupado(s) por local-base</p></div></header>
                <div class="folgas-dia-locais">${conteudo}</div>
            </section>`;
        }

        const viagensPorEscala = new Map();
        const viagensSemEscala = [];
        data.forEach(item => {
            if (item.escala_operacional_id) {
                if (!viagensPorEscala.has(item.escala_operacional_id)) viagensPorEscala.set(item.escala_operacional_id, []);
                viagensPorEscala.get(item.escala_operacional_id).push(item);
            } else {
                viagensSemEscala.push(item);
            }
        });

        const gruposDeEscala = escalasVisiveis.map(escala => {
            const titular = motoristaPorId.get(escala.motorista_titular_id);
            const regra = regraPorId.get(escala.regra_folga_id);
            const viagens = viagensPorEscala.get(escala.id) || [];
            const diasFolga = gerarDatasFolga(escala);
            const excecoesEscala = folgasCarregadas.filter(item => item.escala_operacional_id === escala.id);
            const campoFolga = podeAlterar ? `
                <form class="row g-2 align-items-end mt-2" data-form-folga="${escaparHtml(escala.id)}">
                    <div class="col-sm-4"><label class="form-label small" for="dataFolga-${escaparHtml(escala.id)}">Exceção de calendário</label><input class="form-control form-control-sm" id="dataFolga-${escaparHtml(escala.id)}" type="date" required></div>
                    <div class="col-sm-4"><label class="form-label small" for="tipoFolga-${escaparHtml(escala.id)}">Tipo</label><select class="form-select form-select-sm" id="tipoFolga-${escaparHtml(escala.id)}"><option value="folga">Folga adicional</option><option value="trabalho">Trabalhar (substitui folga do ciclo)</option></select></div>
                    <div class="col-sm-4"><button class="btn btn-sm btn-outline-primary" type="submit">Registrar exceção</button></div>
                </form>` : '';
            const listaFolgas = diasFolga.length
                ? diasFolga.map(item => `<span class="badge text-bg-light me-1 mb-1">${escaparHtml(formatarData(item.data))}</span>`).join('')
                : '<span class="small text-muted">Sem folgas previstas nos próximos 56 dias.</span>';
            const listaExcecoes = excecoesEscala.length
                ? excecoesEscala.map(item => `<span class="badge text-bg-warning me-1 mb-1">${item.tipo === 'folga' ? 'Folga' : 'Trabalho'} · ${escaparHtml(formatarData(item.data_folga))}${item.observacao ? ` · ${escaparHtml(item.observacao)}` : ''}${podeAlterar ? ` <button type="button" class="btn-close ms-1" aria-label="Remover exceção de ${escaparHtml(formatarData(item.data_folga))}" data-acao-folga="excluir" data-id="${escaparHtml(item.id)}"></button>` : ''}</span>`).join('')
                : '<span class="small text-muted">Nenhuma exceção cadastrada.</span>';
            const substituicoesEscala = substituicoesCarregadas.filter(item => item.escala_operacional_id === escala.id);
            const listaSubstituicoes = substituicoesEscala.length
                ? substituicoesEscala.map(item => {
                    const substituto = motoristaPorId.get(item.motorista_substituto_id);
                    return `<span class="badge text-bg-info me-1 mb-1">${escaparHtml(formatarData(item.data_substituicao))} · ${escaparHtml(substituto?.nome || 'Motorista não encontrado')}${podeAlterar ? ` <button type="button" class="btn-close ms-1" aria-label="Remover substituição de ${escaparHtml(formatarData(item.data_substituicao))}" data-acao-substituicao="excluir" data-id="${escaparHtml(item.id)}"></button>` : ''}</span>`;
                }).join('')
                : '<span class="small text-muted">Nenhuma substituição registrada.</span>';
            const campoSubstituicao = podeAlterar ? `
                <form class="row g-2 align-items-end mt-2" data-form-substituicao="${escaparHtml(escala.id)}">
                    <div class="col-sm-4"><label class="form-label small" for="dataSubstituicao-${escaparHtml(escala.id)}">Data</label><input class="form-control form-control-sm" id="dataSubstituicao-${escaparHtml(escala.id)}" type="date" required></div>
                    <div class="col-sm-5"><label class="form-label small" for="motoristaSubstituto-${escaparHtml(escala.id)}">Substituto do dia</label><select class="form-select form-select-sm" id="motoristaSubstituto-${escaparHtml(escala.id)}" required><option value="">Selecione o motorista...</option>${motoristasCarregados.map(motorista => `<option value="${escaparHtml(motorista.id)}">${escaparHtml(motorista.nome)} (${escaparHtml(motorista.matricula)})</option>`).join('')}</select></div>
                    <div class="col-sm-3"><button class="btn btn-sm btn-outline-primary" type="submit">Registrar substituto</button></div>
                </form>` : '';
            return `<section class="escala-grupo-motorista">
                <header class="escala-grupo-cabecalho">
                    <div class="escala-motorista-identidade"><span class="escala-avatar" aria-hidden="true">${escaparHtml(iniciaisDoNome(escala.codigo))}</span><div>
                        <h3>${escaparHtml(escala.codigo)}</h3>
                        <span>Titular: ${escaparHtml(titular?.nome || 'Motorista não encontrado')} · Matrícula ${escaparHtml(titular?.matricula || '-')}</span>
                        ${escala.motorista_substituto_fixo_id ? `<div class="small text-muted">Substituto fixo nas folgas: ${escaparHtml(motoristaPorId.get(escala.motorista_substituto_fixo_id)?.nome || 'Motorista não encontrado')}</div>` : ''}
                        ${escala.local_base ? `<div class="small text-muted">Local-base: ${escaparHtml(escala.local_base)}</div>` : ''}
                    </div></div>
                    <div class="d-flex align-items-center gap-2"><span class="escala-contagem">${viagens.length} ${viagens.length === 1 ? 'viagem' : 'viagens'}</span>
                        ${podeAlterar ? `<button class="btn btn-sm btn-outline-primary" type="button" data-acao-escala="editar-operacional" data-id="${escaparHtml(escala.id)}">Editar escala</button>` : ''}
                    </div>
                </header>
                <div class="p-3 border-bottom"><div class="small text-muted mb-1">Folgas previstas nos próximos 56 dias${regra ? ` · ${escaparHtml(regra.nome)} (${escaparHtml(regra.padrao_ciclo)})` : ' · sem regra automática'}</div>
                    <div>${listaFolgas}</div><div class="small text-muted mt-2 mb-1">Exceções</div><div>${listaExcecoes}</div>${campoFolga}
                    <div class="small text-muted mt-3 mb-1">Substituições por data</div><div>${listaSubstituicoes}</div>${campoSubstituicao}
                </div>
                <div class="escala-turnos">${viagens.length ? viagens.map(item => renderizarViagem(item, escala.codigo)).join('') : '<div class="escala-vazia">Nenhuma viagem vinculada a esta escala no período selecionado.</div>'}</div>
            </section>`;
        });

        const gruposLegados = new Map();
        viagensSemEscala.forEach(item => {
            const nome = item.funcionarios?.nome || 'Motorista removido';
            const key = item.motorista_id || nome;
            if (!gruposLegados.has(key)) gruposLegados.set(key, { nome, matricula: item.funcionarios?.matricula || '-', viagens: [] });
            gruposLegados.get(key).viagens.push(item);
        });
        const listaLegados = [...gruposLegados.values()].map(grupo => `
            <section class="escala-grupo-motorista">
                <header class="escala-grupo-cabecalho"><div class="escala-motorista-identidade"><span class="escala-avatar" aria-hidden="true">${escaparHtml(iniciaisDoNome(grupo.nome))}</span><div><h3>Sem código · ${escaparHtml(grupo.nome)}</h3><span>Matrícula ${escaparHtml(grupo.matricula)} · viagem legada ainda não vinculada</span></div></div><span class="escala-contagem">${grupo.viagens.length} ${grupo.viagens.length === 1 ? 'viagem' : 'viagens'}</span></header>
                <div class="escala-turnos">${grupo.viagens.map(item => renderizarViagem(item, grupo.nome)).join('')}</div>
            </section>`).join('');

        const gruposHtml = [...gruposDeEscala, listaLegados].filter(Boolean).join('')
            || '<div class="escala-vazia">Nenhuma escala ou viagem encontrada para esses filtros.</div>';
        listaEscalas.innerHTML = renderizarPainelFolgas() + gruposHtml;
    }

    function resetarFormulario() {
        if (formEscala) {
            formEscala.reset();
            document.getElementById('escalaMotoristaId').disabled = false;
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
        configurarCampoHora(document.getElementById('escalaInicio'));
        configurarCampoHora(document.getElementById('escalaFim'));
        const selectEscalaOperacional = document.getElementById('escalaOperacionalId');
        const selectMotorista = document.getElementById('escalaMotoristaId');
        selectEscalaOperacional.addEventListener('change', () => {
            const escala = escalasOperacionaisCarregadas.find(item => item.id === selectEscalaOperacional.value);
            if (escala) selectMotorista.value = escala.motorista_titular_id;
            selectMotorista.disabled = Boolean(escala);
            atualizarAvisoFolga();
        });
        document.getElementById('escalaData').addEventListener('change', atualizarAvisoFolga);

        formEscala.addEventListener('submit', async (event) => {
            event.preventDefault();
            const escalaSelecionada = escalasOperacionaisCarregadas.find(item =>
                item.id === document.getElementById('escalaOperacionalId').value
            );

            const dados = {
                data_escala: document.getElementById('escalaData').value,
                linha_id: document.getElementById('escalaLinhaId').value,
                carro_id: document.getElementById('escalaCarroId').value,
                motorista_id: escalaSelecionada?.motorista_titular_id || document.getElementById('escalaMotoristaId').value,
                escala_operacional_id: escalaSelecionada?.id || null,
                hora_inicio: document.getElementById('escalaInicio').value,
                hora_fim: document.getElementById('escalaFim').value,
                local_inicio: document.getElementById('escalaLocalInicio').value.trim() || null,
                local_final: document.getElementById('escalaLocalFinal').value.trim() || null,
            };

            if (!dados.data_escala || !dados.linha_id || !dados.carro_id || !dados.motorista_id || !dados.hora_inicio || !dados.hora_fim) {
                alert('Preencha todos os campos obrigatórios antes de salvar.');
                return;
            }

            const formatoHora24h = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
            if (!formatoHora24h.test(dados.hora_inicio) || !formatoHora24h.test(dados.hora_fim)) {
                alert('Informe os horários no formato de 24 horas, entre 00:00 e 23:59.');
                return;
            }

            const [inicioHora, inicioMinuto] = dados.hora_inicio.split(':').map(Number);
            const [fimHora, fimMinuto] = dados.hora_fim.split(':').map(Number);
            const inicioMinutos = (inicioHora * 60) + inicioMinuto;
            const fimMinutos = (fimHora * 60) + fimMinuto;

            if (fimMinutos === inicioMinutos) {
                alert('A hora final deve ser diferente da hora inicial.');
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
        document.getElementById('escalaOperacionalId').value = data.escala_operacional_id || '';
        document.getElementById('escalaMotoristaId').value = data.motorista_id || '';
        document.getElementById('escalaMotoristaId').disabled = Boolean(data.escala_operacional_id);
        document.getElementById('escalaInicio').value = data.hora_inicio ? formatarHora(data.hora_inicio) : '';
        document.getElementById('escalaFim').value = data.hora_fim ? formatarHora(data.hora_fim) : '';
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
                const campos = 'linha_id, carro_id, motorista_id, escala_operacional_id, motorista_substituto_id, hora_inicio, hora_fim, local_inicio, local_final';
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
                    escala.escala_operacional_id,
                    escala.motorista_substituto_id,
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

    const botaoNovaEscalaOperacional = document.querySelector('[data-bs-target="#modalEscalaOperacional"]');
    if (botaoNovaEscalaOperacional) {
        botaoNovaEscalaOperacional.addEventListener('click', resetarFormularioEscalaOperacional);
    }

    const botaoNovaEscala = document.querySelector('[data-bs-target="#modalEscala"]');
    if (botaoNovaEscala) {
        botaoNovaEscala.addEventListener('click', resetarFormulario);
    }

    iniciarEscala();
});
