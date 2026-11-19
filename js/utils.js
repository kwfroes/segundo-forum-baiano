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

/** CPF parcialmente oculto (***.456.789-**) para mensagens e relatórios. */
export function cpfOculto(valor) {
  const d = somenteDigitos(valor).padStart(11, '0');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/* ------------------------------ Senhas ------------------------------ */
/** Gera senha temporária (8 caracteres, com maiúscula, minúscula, número e símbolo; sem caracteres ambíguos) com o gerador criptográfico do navegador. */
export function gerarSenhaTemporaria(tamanho = 8) {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#@%+=?'];
  const todos = grupos.join('');
  const sorteio = (max) => {                      // sem viés (rejeição)
    const limite = Math.floor(0x100000000 / max) * max;
    const b = new Uint32Array(1);
    do { crypto.getRandomValues(b); } while (b[0] >= limite);
    return b[0] % max;
  };
  const chars = grupos.map((g) => g[sorteio(g.length)]);          // ao menos 1 de cada grupo
  while (chars.length < tamanho) chars.push(todos[sorteio(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = sorteio(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
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
  for (const f of filhos.flat(Infinity)) {
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

/**
 * Decodifica o conteúdo de um arquivo CSV: UTF-8 (com ou sem BOM) e, se inválido,
 * Windows-1252 (CSV "ANSI" salvo pelo Excel).
 */
export function decodificarArquivo(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Interpretador de CSV (aspas, quebras de linha em campos, ";" ou "," como separador, BOM).
 * Cada linha retornada recebe a propriedade `numero` = linha física no arquivo (1 = cabeçalho).
 * Linhas totalmente em branco são descartadas.
 */
export function interpretarCsv(texto) {
  const t = texto.replace(/^\uFEFF/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const saida = [];
  let campo = ''; let linha = []; let aspas = false; let numero = 1; let inicio = 1;
  const fechar = () => {
    linha.push(campo); campo = '';
    if (linha.some((c) => c.trim() !== '')) { linha.numero = inicio; saida.push(linha); }
    linha = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else { campo += c; if (c === '\n') numero++; }
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fechar(); numero++; inicio = numero;
    } else campo += c;
  }
  if (campo !== '' || linha.length) fechar();
  return saida;
}

/** Mensagem amigável a partir de erro do Supabase (sem vazar detalhes técnicos). */
export function mensagemErro(erro) {
  if (!erro) return 'Erro desconhecido.';
  if (erro.code === '42501') return 'Você não tem permissão para esta operação.';
  if (erro.code === '22023') return erro.message;
  if (erro.message && /Failed to fetch|NetworkError|Load failed/i.test(erro.message)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return erro.message || 'Falha ao processar a solicitação.';
}
