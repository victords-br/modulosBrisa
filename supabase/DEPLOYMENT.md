# Administração de usuários de TI

## Escalas por código, viagens e folgas

1. Execute `escalas_operacionais.sql` no SQL Editor depois de `role_permissions.sql`. O script cria os cadastros de escala operacional e regra de folga, adiciona o vínculo opcional das viagens existentes, registra substituições e protege o titular e a vigência no banco.
2. Execute `escalas_substituto_fixo.sql` depois de `escalas_operacionais.sql`. O script adiciona o substituto padrão da escala e aplica a regra de folga às viagens.
3. Execute `escalas_folgas_automaticas.sql` depois de `escalas_substituto_fixo.sql`. A migração adiciona o local-base, impede vigências sobrepostas para o mesmo titular, valida a disponibilidade do substituto durante todo o dia e cria a consulta que agrupa folgas por data e local.
4. Execute novamente `driver_access.sql` depois das migrações anteriores. “Minha escala” passa a exibir as viagens atribuídas ao motorista e as folgas previstas para o titular no período consultado.
5. Na tela TI, configure regras de ciclo usando `T` para trabalho e `F` para folga (por exemplo, `TTTTTF` para 5x1 e `TTTTTTF` para 6x1). O ciclo se repete a partir do início de vigência da escala; é possível cadastrar um padrão de até 56 dias e exceções por data na tela Escala.
6. Na tela Escala, crie cada código (por exemplo `0022.01`), selecione o titular, o substituto fixo, a regra e o local-base das folgas. Um motorista titular não pode estar em códigos com vigências sobrepostas; períodos sem sobreposição são permitidos. Se o substituto estiver alocado em outra escala no mesmo dia, a cobertura fica **Escala em branco**. O painel da data reúne automaticamente os titulares de folga por local-base; isso é um aviso de folga/cobertura, não cria uma viagem com linha, carro e horário.
7. Vincule viagens pelo seletor **Escala operacional**. Em uma folga, a viagem usa o substituto disponível; se não houver cobertura, fica marcada como **Escala em branco**. Uma substituição por data pode preencher a vaga com outro motorista disponível. Viagens antigas permanecem preservadas e aparecem como **Sem código** até serem editadas e vinculadas manualmente.
8. O painel de folgas aparece na tela Escala quando uma data é selecionada e também na impressão/PDF. “Minha escala” exibe cada folga do titular com a data, o código e o local-base. Viagens em branco não são atribuídas a nenhum motorista.

Um padrão 6x1 que simplesmente se repete a cada sete dias mantém a folga no mesmo dia da semana. A alternância entre sábados e domingos precisa de um ciclo personalizado, com todas as folgas e dias trabalhados definidos no período; revise o padrão com a operação antes de aplicá-lo. A configuração não substitui a validação das regras trabalhistas aplicáveis.

## Acesso do motorista à própria escala

1. Execute `driver_access.sql` no SQL Editor depois de `escalas_folgas_automaticas.sql`. O script cria o setor `Motorista`, adiciona o vínculo de funcionário ao perfil e atualiza a RPC restrita `minhas_escalas_motorista` para retornar viagens atribuídas e folgas do titular.
2. Publique a versão atualizada da função de administração, usada pela tela TI para associar a conta a um funcionário:

```bash
supabase functions deploy manage-users
```

3. Na tela TI, edite ou cadastre a conta, selecione o setor `Motorista` e associe o funcionário correspondente. A conta sem esse vínculo recebe uma mensagem de configuração e não vê escalas.
4. O motorista entra pela tela de login e é enviado direto a `motorista.html`; essa página consulta exclusivamente as escalas do funcionário associado ao perfil.

O motorista não recebe acesso ao portal nem aos módulos Financeiro, Escala de administração, Usuários ou Auditoria.

## Implantar auditoria

1. Execute `audit.sql` no SQL Editor do Supabase. Ela cria a tabela append-only `audit_logs`, libera a leitura somente para TI e adiciona gatilhos para lançamentos e escalas. Se a auditoria já estava instalada antes de `escalas_operacionais.sql`, execute `audit.sql` novamente para incluir os novos cadastros.
2. Publique a versão atualizada da função para registrar criação, edição e exclusão de usuários:

```bash
supabase functions deploy manage-users
```

3. Acesse **Auditoria** pela navegação do módulo TI. O histórico começa a ser gravado após a instalação; alterações anteriores não são retroativas.

Senhas e tokens não são armazenados nos eventos. A tabela de auditoria não permite edição ou exclusão pelo cliente.

## Ativar o primeiro usuário TI

1. Execute `role_permissions.sql` no SQL Editor do Supabase. O script cria o setor `TI` e aplica as permissões dos módulos.
2. Escolha um usuário Auth existente como responsável inicial de TI e execute, substituindo o e-mail:

```sql
UPDATE public.perfis
SET setor_id = (SELECT id FROM public.setores WHERE nome = 'TI')
WHERE id = (
    SELECT id
    FROM auth.users
    WHERE email = 'EMAIL_DO_PROFISSIONAL_TI'
);
```

Confirme que exatamente um perfil foi atualizado. Não compartilhe nem coloque a service-role key no navegador.

## Publicar a função segura

Na pasta do projeto, vincule o CLI Supabase ao projeto e publique a Edge Function:

```bash
supabase login
supabase link --project-ref tbhpyhzbegahcxwfjjev
supabase functions deploy manage-users
```

A função exige `SUPABASE_SERVICE_ROLE_KEY` no ambiente Edge Functions do projeto. O segredo não deve ser salvo neste repositório. O endpoint valida o JWT do chamador e permite operações somente quando o perfil pertence ao setor `TI`.

## Funcionalidades

- Para ativar lançamentos detalhados por viagem, execute `lancamentos_por_viagem.sql` no SQL Editor depois de `role_permissions.sql`. O script cria os campos de vínculo com a escala e quantidades de passageiros, habilita a consulta de escalas pelo Financeiro e instala as funções protegidas de tarifas e gravação.
- Cada registro de `escalas_trabalho` representa uma viagem, com sua própria linha, data e horário; `escala_operacional_id` agrupa viagens em um código sem fixar a escala a uma linha. Motorista (valor da garagem), Excesso e KM são informados por viagem; Comum, Escolar e VT são quantidades multiplicadas pelas tarifas configuradas em TI. O SIT (soma de Comum + Escolar + VT) é calculado no banco e fica disponível apenas para consultas de backend; Pagantes foi retirado da tela e do total.
- Para ativar o SIT calculado e o novo Total (SIT + Motorista + Excesso), execute `financeiro_sit.sql` no SQL Editor depois de `lancamentos_por_viagem.sql`. A migração passa a gravar o SIT (Comum + Escolar + VT) na coluna `valor_city` — que permanece no banco, disponível apenas para consultas de backend — e recalcula as linhas já existentes. A coluna `valor_total` continua sendo gerada por `valor_city + Motorista + Excesso`, sem alteração de estrutura.
- Para o indicador R$ / km em "Todos os Lançamentos", execute `financeiro_km.sql` no SQL Editor depois de `lancamentos_por_viagem.sql`. A coluna mostra o Total dividido pelo KM, em verde quando o R$ / km é igual ou maior que a tarifa de VT e em vermelho quando fica abaixo. O script libera, somente para Administração, Financeiro e TI, a leitura da tarifa de VT configurada em TI.
- Para corrigir a coluna "Motorista" (que estava recebendo a quantidade de passageiros) e o Total, execute `financeiro_motorista_pagantes.sql` no SQL Editor depois de `financeiro_sit.sql`. A migração cria o campo de quantidade `Motorista (qtd.)`, migra os dados já lançados e passa a gravar em `valor_garagem` o valor em R$ (`Pagantes (R$)` = quantidade × tarifa Pagantes). O Total continua sendo a coluna gerada `valor_city + valor_garagem + valor_excesso`, sem alterar a estrutura nem as views. Rode o script uma única vez.
- As tarifas iniciais são Comum R$ 4,50, Escolar R$ 2,25, Pagantes R$ 4,80 e VT R$ 4,50. TI pode alterá-las na própria tela de administração. O cálculo ocorre no banco e cada valor final fica salvo no lançamento.
- listar usuários Auth com nome, setor, status de confirmação e data de criação
- criar usuários com setor e opção de confirmar o e-mail imediatamente
- alterar nome, e-mail, setor, senha e confirmação de e-mail
- excluir usuários, exceto a própria conta e o último usuário do setor TI
