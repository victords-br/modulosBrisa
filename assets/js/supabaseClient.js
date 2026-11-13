// Inicializa a conexão
function inicializarSupabase() {
    const SUPABASE_URL = 'https://tbhpyhzbegahcxwfjjev.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_Imlo2eJULp-_qEtMFj4PbQ_L_nV5K1k';

    if (typeof supabase !== 'undefined' && supabase.createClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('Supabase conectado com sucesso!');
    } else {
        console.error('Erro: SDK do Supabase não carregou. Verifique a tag <script> no HTML.');
    }
}

window.logout = async function() {
    if (window.supabaseClient && window.supabaseClient.auth) {
        try {
            await window.supabaseClient.auth.signOut();
        } catch (error) {
            console.warn('Falha ao encerrar sessão no Supabase:', error);
        }
    }

    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (error) {
        console.warn('Não foi possível limpar storage local:', error);
    }

    window.location.href = 'index.html';
};

// Executa imediatamente
inicializarSupabase();