/**
 * auth.js — RF006: login administrativo, recuperação e redefinição de senha.
 * Somente usuários criados no Supabase Auth E presentes na tabela "administradores"
 * (ativos) conseguem entrar; a verificação é feita pelo banco (fn_meu_perfil).
 */
import { clienteAdmin } from './supabase.js';
import { mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const sb = clienteAdmin();

function msg(alvo, texto, tipo = 'erro') {
  const n = $(alvo);
  n.textContent = texto || '';
  n.className = 'msg ' + tipo;
  n.hidden = !texto;
}

function mostrar(painel) {
  ['painel-login', 'painel-recuperar', 'painel-nova-senha'].forEach((id) => { $(id).hidden = id !== painel; });
}

// Mensagens vindas de redirecionamentos
const params = new URLSearchParams(location.search);
const avisos = {
  sem_acesso: 'Seu usuário não está autorizado a acessar o painel.',
  inatividade: 'Sessão encerrada por inatividade. Entre novamente.',
  trocar_senha: 'Defina uma nova senha para continuar.',
};
if (params.get('erro') && avisos[params.get('erro')] && params.get('erro') !== 'trocar_senha') msg('msg-login', avisos[params.get('erro')], 'info');

const precisaTrocar = (user) => user?.user_metadata?.trocar_senha === true;

/** Exibe a tela de nova senha (primeiro acesso ou senha redefinida por administrador). */
function pedirNovaSenha() {
  mostrar('painel-nova-senha');
  msg('msg-nova', 'Primeiro acesso: defina uma nova senha pessoal para continuar.', 'info');
  $('link-sair-nova').hidden = false;
}

// Fluxo de redefinição de senha (link enviado por e-mail)
sb.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') mostrar('painel-nova-senha'); });

// Sessão já existente → painel
(async () => {
  const hashRecuperacao = location.hash.includes('type=recovery');
  const { data: { session } } = await sb.auth.getSession();
  if (session && !hashRecuperacao) {
    const { data: perfil } = await sb.rpc('fn_meu_perfil');
    if (perfil && precisaTrocar(session.user)) pedirNovaSenha();
    else if (perfil) location.replace('dashboard.html');
  }
})();

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg('msg-login', '');
  const email = $('email').value.trim();
  const senha = $('senha').value;
  if (!email || !senha) return msg('msg-login', 'Informe e-mail e senha.');
  const btn = $('btn-entrar'); btn.disabled = true;
  try {
    const { data: login, error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) return msg('msg-login', 'E-mail ou senha inválidos.');
    const { data: perfil, error: e2 } = await sb.rpc('fn_meu_perfil');
    if (e2 || !perfil) {
      await sb.auth.signOut();
      return msg('msg-login', 'Seu usuário não está autorizado a acessar o painel.');
    }
    if (precisaTrocar(login?.user)) return pedirNovaSenha();
    location.replace('dashboard.html');
  } catch (err) {
    msg('msg-login', mensagemErro(err));
  } finally {
    $('senha').value = ''; btn.disabled = false;
  }
});

$('link-recuperar').addEventListener('click', () => { mostrar('painel-recuperar'); $('email-rec').value = $('email').value; });
$('link-voltar').addEventListener('click', () => mostrar('painel-login'));
$('link-sair-nova').addEventListener('click', async () => { await sb.auth.signOut(); location.replace('index.html'); });

$('form-recuperar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email-rec').value.trim();
  if (!email) return msg('msg-recuperar', 'Informe o e-mail.');
  const destino = new URL('index.html', location.href).href;
  await sb.auth.resetPasswordForEmail(email, { redirectTo: destino });
  // Resposta neutra: não revela se o e-mail existe
  msg('msg-recuperar', 'Se o e-mail estiver cadastrado, você receberá as instruções de redefinição.', 'ok');
});

$('form-nova-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s1 = $('nova-senha').value, s2 = $('nova-senha2').value;
  if (s1.length < 8) return msg('msg-nova', 'Use ao menos 8 caracteres.');
  if (s1 !== s2) return msg('msg-nova', 'As senhas não coincidem.');
  const { error } = await sb.auth.updateUser({ password: s1, data: { trocar_senha: false } });
  if (error) return msg('msg-nova', 'Não foi possível definir a senha: ' + mensagemErro(error));
  msg('msg-nova', 'Senha atualizada. Redirecionando…', 'ok');
  setTimeout(() => location.replace('dashboard.html'), 1200);
});
