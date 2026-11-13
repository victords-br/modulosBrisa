# Administração de usuários de TI

## Acesso do motorista à própria escala

1. Execute `driver_access.sql` no SQL Editor depois de `role_permissions.sql`. O script cria o setor `Motorista`, adiciona o vínculo de funcionário ao perfil e a RPC restrita `minhas_escalas_motorista`.
2. Publique a versão atualizada da função de administração, usada pela tela TI para associar a conta a um funcionário:

```bash
supabase functions deploy manage-users
```

3. Na tela TI, edite ou cadastre a conta, selecione o setor `Motorista` e associe o funcionário correspondente. A conta sem esse vínculo recebe uma mensagem de configuração e não vê escalas.
4. O motorista entra pela tela de login e é enviado direto a `motorista.html`; essa página consulta exclusivamente as escalas do funcionário associado ao perfil.

O motorista não recebe acesso ao portal nem aos módulos Financeiro, Escala de administração, Usuários ou Auditoria.

## Implantar auditoria

1. Execute `audit.sql` no SQL Editor do Supabase. Ela cria a tabela append-only `audit_logs`, libera a leitura somente para TI e adiciona gatilhos para lançamentos e escalas.
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

- listar usuários Auth com nome, setor, status de confirmação e data de criação
- criar usuários com setor e opção de confirmar o e-mail imediatamente
- alterar nome, e-mail, setor, senha e confirmação de e-mail
- excluir usuários, exceto a própria conta e o último usuário do setor TI
