/**
 * dashboard.js — RF007: indicadores e gráfico de evolução dos check-ins.
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

function svg(tag, attrs = {}, texto) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function desenharGrafico(evolucao) {
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

  // grade e eixos (marcas sempre inteiras)
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
    const bh = (e.total / topB) * h;
    const x = m.l + passo * i + (passo - largura) / 2;
    const r = svg('rect', { x, y: m.t + h - bh, width: largura, height: bh, rx: 3, fill: '#1598E5' });
    r.append(svg('title', {}, `${formatarHoraCurta(e.intervalo)} — ${e.total} check-in(s)`));
    g.append(r);
    const passoRotulo = Math.ceil(evolucao.length / 12);
    if (i % passoRotulo === 0) g.append(svg('text', { x: x + largura / 2, y: A - 14, 'text-anchor': 'middle' }, formatarHoraCurta(e.intervalo)));
  });

  const pontos = acumulado.map((v, i) => `${m.l + passo * i + passo / 2},${m.t + h - (v / topA) * h}`).join(' ');
  g.append(svg('polyline', { points: pontos, fill: 'none', stroke: '#B3131B', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  acumulado.forEach((v, i) => g.append(svg('circle', { cx: m.l + passo * i + passo / 2, cy: m.t + h - (v / topA) * h, r: 3.5, fill: '#B3131B' })));
}

function preencher(d) {
  $('ind-total').textContent = fmtNum.format(d.total_inscritos);
  $('ind-confirmadas').textContent = fmtNum.format(d.inscricoes_confirmadas);
  $('ind-checkins').textContent = fmtNum.format(d.checkins_realizados);
  $('ind-pendentes').textContent = fmtNum.format(d.pendentes_checkin);
  $('ind-nao-confirmadas').textContent = fmtNum.format(d.inscricoes_nao_confirmadas);
  $('ind-percentual').textContent = Number(d.percentual_presenca).toLocaleString('pt-BR', { minimumFractionDigits: 1 }) + '%';
  $('ind-barra').style.width = Math.min(100, Number(d.percentual_presenca)) + '%';
  desenharGrafico(d.evolucao || []);

  const ul = $('recentes'); limpar(ul);
  if (!d.ultimos?.length) ul.append(el('li', { class: 'vazio' }, 'Sem registros ainda.'));
  (d.ultimos || []).forEach((u) => ul.append(el('li', {},
    el('span', {}, u.nome, u.metodo === 'administrativo' ? el('span', { class: 'etiqueta cinza' }, ' manual') : null),
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
  const { data: cfg } = await sb.rpc('fn_admin_config_obter');
  if (cfg) {
    $('cfg-aberto').value = String(cfg.checkin_aberto !== false);
    $('cfg-tempo').value = cfg.tempo_retorno_segundos ?? 8;
  }
  $('cfg-salvar').addEventListener('click', async () => {
    const tempo = Number($('cfg-tempo').value);
    const r1 = await sb.rpc('fn_admin_config_salvar', { p_chave: 'checkin_aberto', p_valor: $('cfg-aberto').value === 'true' });
    const r2 = await sb.rpc('fn_admin_config_salvar', { p_chave: 'tempo_retorno_segundos', p_valor: tempo });
    const erro = r1.error || r2.error;
    if (erro) aviso(mensagemErro(erro), 'erro'); else aviso('Configurações salvas.', 'ok');
  });
}
