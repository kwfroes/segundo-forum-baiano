/**
 * dashboard.js — RF007: indicadores e gráfico de evolução dos check-ins,
 * com as informações do CHECK-IN DUPLO (manhã / tarde / nos dois / pendentes).
 * Atualização automática a cada 10 s (consulta leve à função fn_admin_dashboard).
 */
import { iniciarPagina, aviso } from './admin-shell.js';
import { formatarHoraCurta, formatarDataHora, el, limpar, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const ATUALIZAR_MS = 10000;

const ctx = await iniciarPagina({ requer: 'staff', pagina: 'dashboard.html' });
const { sb, ehAdmin } = ctx;

if (new URLSearchParams(location.search).get('erro') === 'permissao') $('msg-permissao').hidden = false;

const fmtNum = new Intl.NumberFormat('pt-BR');
const fmtPct = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const horaTexto = (t) => { const [h, m] = String(t || '').split(':'); return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`; };
const NOME_PERIODO = { manha: 'da manhã', tarde: 'da tarde', unico: '' };

function svg(tag, attrs = {}, texto) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (texto !== undefined) n.textContent = texto;
  return n;
}

/* ------------------------------- Gráfico ------------------------------- */
const COR_MANHA = '#1598E5', COR_TARDE = '#218653';

function desenharGrafico(evolucao, duplo) {
  const g = $('grafico');
  limpar(g);
  const L = 720, A = 280, m = { t: 14, r: 46, b: 36, l: 40 };
  const w = L - m.l - m.r, h = A - m.t - m.b;

  if (!evolucao.length) {
    g.append(svg('text', { x: L / 2, y: A / 2, 'text-anchor': 'middle' }, 'Nenhum check-in registrado até o momento.'));
    return;
  }
  const maxB = Math.max(...evolucao.map((e) => e.total), 1);
  let acc = 0;
  const acumulado = evolucao.map((e) => (acc += e.total));
  const maxA = Math.max(acc, 1);
  const passo = w / evolucao.length;
  const largura = Math.max(Math.min(passo * 0.7, 48), 4);

  const marcas = Math.max(1, Math.min(4, Math.max(maxB, maxA)));
  const tB = Math.ceil(maxB / marcas), tA = Math.ceil(maxA / marcas);
  const topB = tB * marcas, topA = tA * marcas;
  for (let i = 0; i <= marcas; i++) {
    const y = m.t + h - (h * i) / marcas;
    g.append(svg('line', { x1: m.l, x2: L - m.r, y1: y, y2: y, stroke: '#E3ECF3' }));
    g.append(svg('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, tB * i));
    g.append(svg('text', { x: L - m.r + 6, y: y + 4, 'text-anchor': 'start' }, tA * i));
  }

  evolucao.forEach((e, i) => {
    const x = m.l + passo * i + (passo - largura) / 2;
    const hManha = ((duplo ? e.manha : e.total) / topB) * h;
    const hTarde = duplo ? (e.tarde / topB) * h : 0;
    const base = m.t + h;
    const dica = duplo
      ? `${formatarHoraCurta(e.intervalo)} — manhã: ${e.manha} · tarde: ${e.tarde}`
      : `${formatarHoraCurta(e.intervalo)} — ${e.total} check-in(s)`;
    if (hManha > 0) { const r = svg('rect', { x, y: base - hManha, width: largura, height: hManha, rx: 2, fill: COR_MANHA }); r.append(svg('title', {}, dica)); g.append(r); }
    if (hTarde > 0) { const r = svg('rect', { x, y: base - hManha - hTarde, width: largura, height: hTarde, rx: 2, fill: COR_TARDE }); r.append(svg('title', {}, dica)); g.append(r); }
    const passoRotulo = Math.ceil(evolucao.length / 12);
    if (i % passoRotulo === 0) g.append(svg('text', { x: x + largura / 2, y: A - 14, 'text-anchor': 'middle' }, formatarHoraCurta(e.intervalo)));
  });

  const pontos = acumulado.map((v, i) => `${m.l + passo * i + passo / 2},${m.t + h - (v / topA) * h}`).join(' ');
  g.append(svg('polyline', { points: pontos, fill: 'none', stroke: '#B3131B', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  acumulado.forEach((v, i) => g.append(svg('circle', { cx: m.l + passo * i + passo / 2, cy: m.t + h - (v / topA) * h, r: 3.5, fill: '#B3131B' })));
}

/* ------------------------------- Painel ------------------------------- */
function rotuloPeriodoAtual(d) {
  switch (d.periodo_atual) {
    case 'manha': return { cls: 'manha', texto: `Agora: manhã (até ${horaTexto(d.manha_ate)})` };
    case 'tarde': return { cls: 'tarde', texto: `Agora: tarde (a partir de ${horaTexto(d.tarde_de)})` };
    case 'intervalo': return { cls: 'intervalo', texto: `Agora: intervalo — check-in público fechado até ${horaTexto(d.tarde_de)}` };
    default: return { cls: '', texto: '' };
  }
}

function preencher(d) {
  const duplo = d.duplo === true;

  $('ind-total').textContent = fmtNum.format(d.total_inscritos);
  $('ind-confirmadas').textContent = fmtNum.format(d.inscricoes_confirmadas);
  $('ind-checkins').textContent = fmtNum.format(d.checkins_realizados);
  $('ind-pendentes').textContent = fmtNum.format(d.pendentes_checkin);
  $('ind-nao-confirmadas').textContent = fmtNum.format(d.inscricoes_nao_confirmadas);
  $('ind-percentual').textContent = fmtPct(d.percentual_presenca);
  $('ind-barra').style.width = Math.min(100, Number(d.percentual_presenca)) + '%';
  $('rot-presentes').textContent = duplo ? 'Presentes (ao menos 1 período)' : 'Check-ins realizados';
  $('rot-pendentes').textContent = duplo ? 'Sem nenhum check-in' : 'Pendentes de check-in';

  const ni = $('nota-incluidos');
  ni.hidden = !(d.incluidos_manualmente > 0);
  ni.textContent = d.incluidos_manualmente > 0 ? `${fmtNum.format(d.incluidos_manualmente)} participante(s) incluído(s) manualmente, fora da base importada.` : '';

  // ---- check-in duplo ----
  $('painel-duplo').hidden = !duplo;
  $('leg-manha').textContent = duplo ? 'Manhã' : 'Check-ins no intervalo';
  $('leg-tarde').hidden = !duplo;
  if (duplo) {
    const sel = $('periodo-atual'); const r = rotuloPeriodoAtual(d);
    sel.className = 'selo-periodo ' + r.cls; sel.textContent = r.texto;
    $('d-manha').textContent = fmtNum.format(d.manha.presentes);
    $('d-manha-sub').textContent = `${fmtPct(d.manha.percentual)} dos confirmados`;
    $('d-tarde').textContent = fmtNum.format(d.tarde.presentes);
    $('d-tarde-sub').textContent = `${fmtPct(d.tarde.percentual)} dos confirmados`;
    $('d-ambos').textContent = fmtNum.format(d.nos_dois_periodos);
    $('d-so-manha').textContent = fmtNum.format(d.so_manha);
    $('d-so-tarde').textContent = fmtNum.format(d.so_tarde);
    $('d-pend-manha').textContent = fmtNum.format(d.manha.pendentes);
    $('d-pend-tarde').textContent = fmtNum.format(d.tarde.pendentes);
    const nu = $('nota-unicos');
    nu.hidden = !(d.checkins_periodo_unico > 0);
    nu.textContent = d.checkins_periodo_unico > 0
      ? `${fmtNum.format(d.checkins_periodo_unico)} check-in(s) foram feitos antes de ativar o check-in duplo (período único) e não entram nos números da manhã nem da tarde.` : '';
  }

  desenharGrafico(d.evolucao || [], duplo);

  const ul = $('recentes'); limpar(ul);
  if (!d.ultimos?.length) ul.append(el('li', { class: 'vazio' }, 'Sem registros ainda.'));
  (d.ultimos || []).forEach((u) => ul.append(el('li', {},
    el('span', {}, u.nome,
      duplo && NOME_PERIODO[u.periodo] ? el('span', { class: 'etiqueta ' + (u.periodo === 'tarde' ? 'verde' : 'azul') }, ' ' + (u.periodo === 'tarde' ? 'tarde' : 'manhã')) : null,
      u.metodo === 'administrativo' ? el('span', { class: 'etiqueta cinza' }, ' manual') : null),
    el('time', { datetime: u.data_hora }, formatarHoraCurta(u.data_hora)))));
  $('atualizado').textContent = 'Atualizado em ' + formatarDataHora(d.atualizado_em);
}

let ocupado = false;
async function carregar() {
  if (ocupado || document.hidden) return;
  ocupado = true;
  const { data, error } = await sb.rpc('fn_admin_dashboard', { p_intervalo_min: Number($('intervalo').value) });
  ocupado = false;
  if (error) { aviso(mensagemErro(error), 'erro'); return; }
  preencher(data);
}

$('intervalo').addEventListener('change', carregar);
document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
await carregar();
setInterval(carregar, ATUALIZAR_MS);

/* ----------------------- Configurações (administrador) ----------------------- */
if (ehAdmin) {
  const atualizarCamposDuplo = () => {
    const ligado = $('cfg-duplo').value === 'true';
    $('cfg-manha').disabled = !ligado; $('cfg-tarde').disabled = !ligado;
  };
  const { data: cfg } = await sb.rpc('fn_admin_config_obter');
  if (cfg) {
    $('cfg-aberto').value = String(cfg.checkin_aberto !== false);
    $('cfg-tempo').value = cfg.tempo_retorno_segundos ?? 8;
    $('cfg-duplo').value = String(cfg.checkin_duplo === true);
    $('cfg-manha').value = cfg.checkin_manha_ate || '12:00';
    $('cfg-tarde').value = cfg.checkin_tarde_a_partir || '13:30';
  }
  atualizarCamposDuplo();
  $('cfg-duplo').addEventListener('change', atualizarCamposDuplo);

  $('cfg-salvar').addEventListener('click', async () => {
    const manha = $('cfg-manha').value, tarde = $('cfg-tarde').value;
    if ($('cfg-duplo').value === 'true') {
      if (!manha || !tarde) return aviso('Informe os dois horários do check-in duplo.', 'erro');
      if (manha > tarde) return aviso('A manhã não pode terminar depois do início da tarde.', 'erro');
    }
    const r1 = await sb.rpc('fn_admin_config_salvar', { p_chave: 'checkin_aberto', p_valor: $('cfg-aberto').value === 'true' });
    const r2 = await sb.rpc('fn_admin_config_salvar', { p_chave: 'tempo_retorno_segundos', p_valor: Number($('cfg-tempo').value) });
    const r3 = await sb.rpc('fn_admin_config_checkin_salvar', {
      p_duplo: $('cfg-duplo').value === 'true', p_manha_ate: manha || '12:00', p_tarde_de: tarde || '13:30' });
    const erro = r1.error || r2.error || r3.error;
    if (erro) return aviso(mensagemErro(erro), 'erro');
    aviso('Configurações salvas.', 'ok');
    carregar();
  });
}
