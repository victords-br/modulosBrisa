document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.supabaseClient === 'undefined') {
        console.error('Erro crítico: supabaseClient não foi inicializado.');
        return;
    }

    const loginForm = document.getElementById('loginForm');

    async function redirecionarUsuario(user) {
        const { data: perfil, error } = await window.supabaseClient
            .from('perfis')
            .select('setores(nome)')
            .eq('id', user.id)
            .maybeSingle();

        if (error || !perfil) {
            console.error('Não foi possível carregar o setor do usuário:', error);
            window.location.replace('index.html');
            return;
        }

        window.location.replace(perfil.setores?.nome === 'Motorista' ? 'motorista.html' : 'index.html');
    }

    if (!loginForm) {
        return;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');
        const btnSubmit = e.target.querySelector('button[type="submit"]');

        btnSubmit.textContent = 'Entrando...';
        btnSubmit.disabled = true;
        errorDiv.style.display = 'none';

        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = 'Erro: ' + error.message;
            btnSubmit.textContent = 'Entrar';
            btnSubmit.disabled = false;
            return;
        }

        if (data && data.user) {
            await redirecionarUsuario(data.user);
        }
    });

    window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session && window.location.pathname.includes('login.html')) {
            redirecionarUsuario(session.user);
        }
    });
});