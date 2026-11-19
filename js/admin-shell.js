/**
 * admin-shell.js — proteção de páginas, navegação, diálogos e avisos do painel.
 * A autorização real é feita pelo banco (RLS + validação de perfil nas funções).
 * Este arquivo apenas controla a experiência: redireciona quem não tem acesso.
 *
 * DESEMPENHO DA NAVEGAÇÃO
 *  • Cada item do menu é uma página HTML separada. Para o menu não "piscar" a cada clique, o perfil
 *    (nome e tipo de acesso) fica num cache da aba (sessionStorage) e a barra é desenhada NO INSTANTE
 *    em que este arquivo carrega — antes de baixar a biblioteca do Supabase e antes de qualquer consulta.
 *  • O cache serve só para a aparência. A confirmação do perfil continua sendo feita no banco, em
 *    segundo plano, a cada página; se o acesso foi retirado, a pessoa é desconectada. Nenhuma ação
 *    depende do cache: o banco valida o perfil dentro de cada função.
 *  • A biblioteca do Supabase é carregada sob demanda (import dinâmico), em paralelo.
 */
import { el, limpar } from './utils.js';
import { botaoIcone } from './icones.js';

const INATIVIDADE_MS = 30 * 60 * 1000;      // logout automático após 30 min sem uso
const CHAVE_SESSAO = 'forum-checkin-admin';  // mesma storageKey usada em supabase.js (clienteAdmin)
const CHAVE_PERFIL = 'forum-checkin-perfil'; // cache só da aparência do menu
const VALIDADE_PERFIL_MS = 10 * 60 * 1000;

const PAGINAS = [
  { href: 'dashboard.html',     rotulo: 'Dashboard',     admin: false },
  { href: 'participantes.html', rotulo: 'Participantes', admin: false },
  { href: 'relatorios.html',    rotulo: 'Relatórios',    admin: true  },
  { href: 'importar.html',      rotulo: 'Importar base', admin: true },
  { href: 'usuarios.html',      rotulo: 'Usuários',      admin: true  },
];

// Começa a baixar a biblioteca já, sem travar a montagem da barra.
const supabasePronto = import('./supabase.js');
supabasePronto.catch(() => {});             // o erro, se houver, aparece quando a página aguardar a biblioteca

/* ----------------------- Cache do perfil (somente aparência) ----------------------- */
function sessaoLocal() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
    return s && s.user && s.user.id ? s : null;
  } catch { return null; }
}

/** Perfil guardado, se for da MESMA pessoa logada, recente e sem troca de senha pendente. */
function lerCachePerfil() {
  const s = sessaoLocal();
  if (!s || s.user.user_metadata?.trocar_senha === true) return null;
  try {
    const c = JSON.parse(sessionStorage.getItem(CHAVE_PERFIL) || 'null');
    if (c && c.uid === s.user.id && typeof c.nome === 'string'
        && (c.perfil === 'administrador' || c.perfil === 'operador')
        && Date.now() - c.t < VALIDADE_PERFIL_MS) return c;
  } catch { /* cache inválido: ignora */ }
  return null;
}
function gravarCachePerfil(uid, perfil) {
  try { sessionStorage.setItem(CHAVE_PERFIL, JSON.stringify({ uid, nome: perfil.nome, perfil: perfil.perfil, t: Date.now() })); } catch { /* sem cache */ }
}
function limparCachePerfil() {
  try { sessionStorage.removeItem(CHAVE_PERFIL); } catch { /* ok */ }
}

/* ------------------------------- Barra superior ------------------------------- */
const paginaAtual = (location.pathname.split('/').pop() || '');
let pintado = null;                          // { nome, perfil } do que está na tela

/** Links que existem para qualquer perfil (a lista completa depende do perfil). */
const linksComuns = () => PAGINAS.filter((p) => !p.admin)
  .map((p) => el('a', { href: p.href, 'aria-current': p.href === paginaAtual ? 'page' : null }, p.rotulo));

/** Em telas estreitas o menu rola para o lado: deixa o item da página atual à vista (sem efeito quando o menu cabe). */
function centralizarAtual(nav) {
  const a = nav.querySelector('[aria-current="page"]');
  if (!a || nav.scrollWidth <= nav.clientWidth) return;
  const desloc = a.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft - (nav.clientWidth - a.offsetWidth) / 2;
  nav.scrollLeft = Math.max(0, desloc);
}

/** Nome do evento: texto fixo, pode aparecer antes de se saber quem é o usuário. */
function garantirMarca(topo) {
  topo.className = 'topo-admin';
  if (!topo.querySelector('.marca')) topo.prepend(el('div', { class: 'marca' }, '2º Fórum Baiano', el('small', {}, 'Credenciamento')));
}

function montarTopo(perfil) {
  const topo = document.getElementById('topo');
  if (!topo) return;
  if (pintado && pintado.nome === perfil.nome && pintado.perfil === perfil.perfil) return;   // nada mudou: não redesenha
  garantirMarca(topo);
  topo.querySelectorAll('nav, .usuario').forEach((n) => n.remove());   // troca só o menu e o usuário; a marca fica
  const nav = el('nav', { 'aria-label': 'Principal' },
    PAGINAS.filter((p) => !p.admin || perfil.perfil === 'administrador')
      .map((p) => el('a', { href: p.href, 'aria-current': p.href === paginaAtual ? 'page' : null }, p.rotulo)));
  const sair = botaoIcone({
    icone: 'sair', titulo: 'Sair', tam: 18,
    onclick: async () => {
      limparCachePerfil();
      const { clienteAdmin } = await supabasePronto;
      await clienteAdmin().auth.signOut();
      location.replace('index.html');
    },
  });
  topo.append(
    nav,
    el('div', { class: 'usuario' }, el('span', {}, el('strong', {}, perfil.nome), ' · ', perfil.perfil === 'administrador' ? 'Administrador' : 'Operador'), sair),
  );
  pintado = { nome: perfil.nome, perfil: perfil.perfil };
  centralizarAtual(nav);
}

function aplicarPerfil(perfil) {
  montarTopo(perfil);
  document.querySelectorAll('.so-admin').forEach((n) => { n.hidden = perfil.perfil !== 'administrador'; });
}

// Desenha a barra imediatamente (este código roda assim que o arquivo carrega):
// com o perfil em cache, a barra completa; sem cache, o nome do evento e os links que todos têm
// (os itens de administrador e o nome do usuário entram quando o banco confirmar o perfil).
{
  const c = lerCachePerfil();
  const topo = document.getElementById('topo');
  if (c) montarTopo(c);
  else if (topo && sessaoLocal()) {            // só se houver sessão: quem vai para o login não vê barra
    garantirMarca(topo);
    const navInicial = el('nav', { 'aria-label': 'Principal' }, linksComuns());
    topo.append(navInicial);
    centralizarAtual(navInicial);
  }
}

/* ----------------------------- Verificação do acesso ----------------------------- */
const redirecionar = (url) => { location.replace(url); return new Promise(() => {}); };

/**
 * Verifica sessão e perfil. Redireciona para o login quando necessário.
 * Com o perfil em cache, libera a página na hora e confere no banco em segundo plano.
 */
export async function iniciarPagina({ requer = 'staff' } = {}) {
  const { clienteAdmin } = await supabasePronto;
  const sb = clienteAdmin();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { limparCachePerfil(); return redirecionar('index.html'); }
  // Primeiro acesso / senha redefinida por um administrador: exige trocar a senha antes de usar o painel.
  if (session.user?.user_metadata?.trocar_senha === true) { limparCachePerfil(); return redirecionar('index.html?erro=trocar_senha'); }
  const uid = session.user.id;

  let perfil = null;
  const cache = lerCachePerfil();
  // O cache nunca CONCEDE acesso a página de administrador: nesse caso confirma no banco antes de liberar.
  const confiarNoCache = cache && !(requer === 'admin' && cache.perfil !== 'administrador');

  if (confiarNoCache) {
    perfil = { nome: cache.nome, perfil: cache.perfil };
    conferirEmSegundoPlano(sb, uid, perfil, requer);
  } else {
    const { data, error } = await sb.rpc('fn_meu_perfil');
    if (error || !data) {
      limparCachePerfil();
      await sb.auth.signOut();
      return redirecionar('index.html?erro=sem_acesso');
    }
    if (requer === 'admin' && data.perfil !== 'administrador') { gravarCachePerfil(uid, data); return redirecionar('dashboard.html?erro=permissao'); }
    perfil = data;
    gravarCachePerfil(uid, perfil);
  }

  aplicarPerfil(perfil);
  iniciarInatividade(sb);

  // sessão expirada/encerrada em outra aba
  sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') { limparCachePerfil(); location.replace('index.html'); } });
  return { sb, perfil, ehAdmin: perfil.perfil === 'administrador' };
}

/** Confirma o perfil no banco depois de liberar a página com o cache. Só age se a resposta for conclusiva. */
async function conferirEmSegundoPlano(sb, uid, atual, requer) {
  let resposta;
  try { resposta = await sb.rpc('fn_meu_perfil'); } catch { return; }
  const { data, error } = resposta;
  if (error) return;                         // falha de rede ou outra: mantém a tela, sem desconectar por engano
  if (!data) {                               // o banco confirmou: esta pessoa não tem (mais) acesso
    limparCachePerfil();
    await sb.auth.signOut();
    location.replace('index.html?erro=sem_acesso');
    return;
  }
  gravarCachePerfil(uid, data);
  if (requer === 'admin' && data.perfil !== 'administrador') { location.replace('dashboard.html?erro=permissao'); return; }
  if (data.nome !== atual.nome || data.perfil !== atual.perfil) aplicarPerfil(data);   // perfil mudou: atualiza a barra
}

function iniciarInatividade(sb) {
  let t;
  const reiniciar = () => {
    clearTimeout(t);
    t = setTimeout(async () => { limparCachePerfil(); await sb.auth.signOut(); location.replace('index.html?erro=inatividade'); }, INATIVIDADE_MS);
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
