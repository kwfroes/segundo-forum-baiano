/**
 * utils.js — funções compartilhadas (CPF, datas, DOM, CSV).
 * Nenhum dado pessoal é registrado em console ou armazenamento local.
 */

export const FUSO = 'America/Bahia';

/* ------------------------------- CPF ------------------------------- */
export function somenteDigitos(s) { return String(s ?? '').replace(/\D/g, ''); }

/** Aplica a máscara 000.000.000-00 (aceita colagem com ou sem pontuação). */
export function mascararCpf(valor) {
  const d = somenteDigitos(valor).slice(0, 11);
  let r = d.slice(0, 3);
  if (d.length > 3) r += '.' + d.slice(3, 6);
  if (d.length > 6) r += '.' + d.slice(6, 9);
  if (d.length > 9) r += '-' + d.slice(9, 11);
  return r;
}

/** Valida quantidade de dígitos e dígitos verificadores. */
export function cpfValido(valor) {
  const c = somenteDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}

/* ------------------------------ Datas ------------------------------ */
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'medium' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtHoraCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });

export const formatarDataHora = (iso) => (iso ? fmtDataHora.format(new Date(iso)) : '');
export const formatarData = (iso) => (iso ? fmtData.format(new Date(iso)) : '');
export const formatarHora = (iso) => (iso ? fmtHora.format(new Date(iso)) : '');
export const formatarHoraCurta = (iso) => (iso ? fmtHoraCurta.format(new Date(iso)) : '');

/* ------------------------------- DOM ------------------------------- */
/** Cria elemento sem usar innerHTML (evita XSS). */
export function el(tag, atributos = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return n;
}

export function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }

export function debounce(fn, ms = 350) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* -------------------------------- CSV -------------------------------- */
/** Neutraliza injeção de fórmulas em planilhas (=, +, -, @, TAB, CR). */
export function seguroPlanilha(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Gera CSV (UTF-8 com BOM, separador ';' — abre corretamente no Excel pt-BR). */
export function gerarCsv(colunas, linhas) {
  const esc = (v) => {
    const s = seguroPlanilha(v);
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cab = colunas.map((c) => esc(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => esc(c.valor(l))).join(';'));
  return '\uFEFF' + [cab, ...corpo].join('\r\n');
}

export function baixarArquivo(conteudo, nome, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Interpretador de CSV (aspas, quebras de linha em campos, ; ou , como separador, BOM). */
export function interpretarCsv(texto) {
  let t = texto.replace(/^\uFEFF/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => c.trim() !== ''));
}

/** Mensagem amigável a partir de erro do Supabase (sem vazar detalhes técnicos). */
export function mensagemErro(erro) {
  if (!erro) return 'Erro desconhecido.';
  if (erro.code === '42501') return 'Você não tem permissão para esta operação.';
  if (erro.code === '22023') return erro.message;
  if (erro.message && /Failed to fetch|NetworkError|Load failed/i.test(erro.message)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return erro.message || 'Falha ao processar a solicitação.';
}
