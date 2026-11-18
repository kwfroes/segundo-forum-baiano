/**
 * admin-shell.js — proteção de páginas, navegação, diálogos e avisos do painel.
 * A autorização real é feita pelo banco (RLS + validação de perfil nas funções).
 * Este arquivo apenas controla a experiência: redireciona quem não tem acesso.
 */
import { clienteAdmin } from './supabase.js';
import { el, limpar } from './utils.js';

const INATIVIDADE_MS = 30 * 60 * 1000;   // logout automático após 30 min sem uso

const PAGINAS = [
  { href: 'dashboard.html',     rotulo: 'Dashboard',     admin: false },
  { href: 'participantes.html', rotulo: 'Participantes', admin: false },
  { href: 'relatorios.html',    rotulo: 'Relatórios',    admin: true  },
  { href: 'importar.html',      rotulo: 'Importar base', admin: true  },
  { href: 'usuarios.html',      rotulo: 'Usuários',      admin: true  },
];

/** Verifica sessão e perfil. Redireciona para o login quando necessário. */
export async function iniciarPagina({ requer = 'staff', pagina } = {}) {
  const sb = clienteAdmin();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace('index.html'); return new Promise(() => {}); }
  // Primeiro acesso / senha redefinida por um administrador: exige trocar a senha antes de usar o painel.
  if (session.user?.user_metadata?.trocar_senha === true) { location.replace('index.html?erro=trocar_senha'); return new Promise(() => {}); }

  const { data: perfil, error } = await sb.rpc('fn_meu_perfil');
  if (error || !perfil) {
    await sb.auth.signOut();
    location.replace('index.html?erro=sem_acesso');
    return new Promise(() => {});
  }
  if (requer === 'admin' && perfil.perfil !== 'administrador') {
    location.replace('dashboard.html?erro=permissao');
    return new Promise(() => {});
  }

  montarTopo(sb, perfil, pagina);
  document.querySelectorAll('.so-admin').forEach((n) => { n.hidden = perfil.perfil !== 'administrador'; });
  iniciarInatividade(sb);

  // sessão expirada/encerrada em outra aba
  sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') location.replace('index.html'); });
  return { sb, perfil, ehAdmin: perfil.perfil === 'administrador' };
}

function montarTopo(sb, perfil, pagina) {
  const topo = document.getElementById('topo');
  if (!topo) return;
  limpar(topo);
  topo.className = 'topo-admin';
  const nav = el('nav', { 'aria-label': 'Principal' },
    PAGINAS.filter((p) => !p.admin || perfil.perfil === 'administrador')
      .map((p) => el('a', { href: p.href, 'aria-current': p.href === pagina ? 'page' : null }, p.rotulo)));
  const sair = el('button', { class: 'btn sec pequeno', type: 'button', onclick: async () => { await sb.auth.signOut(); location.replace('index.html'); } }, 'Sair');
  topo.append(
    el('div', { class: 'marca' }, '2º Fórum Baiano', el('small', {}, 'Credenciamento')),
    nav,
    el('div', { class: 'usuario' }, el('span', {}, el('strong', {}, perfil.nome), ' · ', perfil.perfil === 'administrador' ? 'Administrador' : 'Operador'), sair),
  );
}

function iniciarInatividade(sb) {
  let t;
  const reiniciar = () => {
    clearTimeout(t);
    t = setTimeout(async () => { await sb.auth.signOut(); location.replace('index.html?erro=inatividade'); }, INATIVIDADE_MS);
  };
  ['click', 'keydown', 'pointermove', 'touchstart'].forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
  reiniciar();
}

/* ------------------------------ Avisos ------------------------------ */
export function aviso(texto, tipo = 'info') {
  let area = document.querySelector('.toasts');
  if (!area) { area = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(area); }
  const t = el('div', { class: 'toast ' + tipo }, texto);
  area.append(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 8000 : 4500);
}

/* --------------------- Diálogos (substituem alert/confirm/prompt) --------------------- */
export function abrirDialogo({ titulo, corpo, botoes, largo = false }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: largo ? 'largo' : '', 'aria-labelledby': 'dlg-titulo' });
    const rodape = el('div', { class: 'dlg-rodape' });
    botoes.forEach((b) => rodape.append(el('button', {
      class: 'btn ' + (b.classe || ''), type: 'button',
      onclick: () => { dlg.dataset.resultado = b.valor; dlg.close(); },
    }, b.rotulo)));
    dlg.append(el('div', { class: 'dlg-cab' }, el('h2', { id: 'dlg-titulo' }, titulo)), el('div', { class: 'dlg-corpo' }, corpo), rodape);
    dlg.addEventListener('close', () => { const r = dlg.dataset.resultado; dlg.remove(); resolve(r); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Confirmação com motivo opcional/obrigatório. Retorna { ok, motivo }. */
export async function confirmar({ titulo, mensagem, pedirMotivo = false, motivoObrigatorio = false, textoConfirmar = 'Confirmar', perigo = false }) {
  const campo = pedirMotivo ? el('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Motivo', placeholder: 'Motivo' }) : null;
  const erro = el('p', { class: 'msg erro', hidden: true }, 'Informe o motivo (mínimo de 5 caracteres).');
  const corpoMsg = Array.isArray(mensagem) ? mensagem.map((m) => el('p', {}, m)) : el('p', {}, mensagem);
  let resultado;
  do {
    resultado = await abrirDialogo({
      titulo, corpo: [corpoMsg, campo, campo ? erro : null],
      botoes: [{ rotulo: 'Cancelar', valor: 'nao', classe: 'sec' }, { rotulo: textoConfirmar, valor: 'sim', classe: perigo ? 'perigo' : '' }],
    });
    if (resultado === 'sim' && motivoObrigatorio && (campo.value.trim().length < 5)) { erro.hidden = false; resultado = 'repetir'; }
  } while (resultado === 'repetir');
  return { ok: resultado === 'sim', motivo: campo ? campo.value.trim() : '' };
}

export function informar({ titulo, corpo, largo = false }) {
  return abrirDialogo({ titulo, corpo, largo, botoes: [{ rotulo: 'Fechar', valor: 'ok', classe: 'sec' }] });
}
