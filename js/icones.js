/**
 * icones.js — ícones SVG do painel (traço de 2 px, grade 24×24) e botões só com ícone.
 *
 *  • Sem innerHTML e sem atributo "style": o SVG é montado com createElementNS (compatível com a CSP do painel).
 *  • Todo botão só com ícone recebe `title` (dica ao passar o mouse) e `aria-label` (leitores de tela).
 *  • O SVG fica `aria-hidden`: quem "fala" é o botão.
 */
const NS = 'http://www.w3.org/2000/svg';

// [tag, atributos] — desenhos em 24×24, linha 2 px, pontas arredondadas (definidos no próprio <svg>).
const DESENHOS = {
  editar:    [['path', { d: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z' }], ['path', { d: 'M14 7l3 3' }]],
  historico: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  confirmar: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12.5l2.7 2.7L16 9.5' }]],
  desconf:   [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9 9l6 6M15 9l-6 6' }]],
  fechar:    [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  esq:       [['path', { d: 'M15 6l-6 6 6 6' }]],
  dir:       [['path', { d: 'M9 6l6 6-6 6' }]],
  chave:     [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M10.8 12.2L20 3M16 7l3 3M14 9l2 2' }]],
  email:     [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['path', { d: 'M3 7l9 6 9-6' }]],
  'user-x':  [['circle', { cx: 10, cy: 8, r: 4 }], ['path', { d: 'M3 20c0-3.3 3.1-6 7-6s7 2.7 7 6M17 8l4 4M21 8l-4 4' }]],
  'user-ok': [['circle', { cx: 10, cy: 8, r: 4 }], ['path', { d: 'M3 20c0-3.3 3.1-6 7-6s7 2.7 7 6M16 11l2 2 4-4' }]],
  'user-plus': [['circle', { cx: 10, cy: 8, r: 4 }], ['path', { d: 'M3 20c0-3.3 3.1-6 7-6s7 2.7 7 6M19 8v6M16 11h6' }]],
  cadeado:   [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 018 0v3' }]],
  baixar:    [['path', { d: 'M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14' }]],
  atualizar: [['path', { d: 'M20 11a8 8 0 00-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0014.5 3.5L20 15M20 20v-5h-5' }]],
  sair:      [['path', { d: 'M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3M16 8l4 4-4 4M20 12H9' }]],
};

/** Cria o <svg> de um ícone. */
export function icone(nome, tam = 18) {
  const desenho = DESENHOS[nome];
  if (!desenho) throw new Error('Ícone desconhecido: ' + nome);
  const svg = document.createElementNS(NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of desenho) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}

export const nomesDeIcones = () => Object.keys(DESENHOS);

/**
 * Botão só com ícone.
 *  titulo     → dica ao passar o mouse
 *  rotuloAria → nome para leitor de tela (padrão: o próprio título; use para incluir o nome da pessoa)
 *  classe     → 'perigo' (vermelho), 'mini' (menor), 'grande' (altura de campo)…
 */
export function botaoIcone({ icone: nome, titulo, rotuloAria, onclick, classe = '', desabilitado = false, tam = 18 }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = ('btn-icone ' + classe).trim();
  b.title = titulo;
  b.setAttribute('aria-label', rotuloAria || titulo);
  if (desabilitado) b.disabled = true;
  if (onclick) b.addEventListener('click', onclick);
  b.append(icone(nome, tam));
  return b;
}

/** Troca o conteúdo de um botão que já existe no HTML por apenas um ícone (mantém id e ouvintes). */
export function soIcone(botao, nome, titulo, tam = 18) {
  botao.className = 'btn-icone';
  botao.title = titulo;
  botao.setAttribute('aria-label', titulo);
  botao.replaceChildren(icone(nome, tam));
  return botao;
}

/** Troca o conteúdo de um botão que já existe no HTML por ícone + texto (o botão continua com o seu estilo). */
export function comIcone(botao, nome, texto, tam = 16) {
  botao.classList.add('com-icone');
  botao.replaceChildren(icone(nome, tam), document.createTextNode(texto));
  return botao;
}

/** Selo redondo com ícone (substitui etiquetas de texto em tabelas). `classe`: verde | ambar | incl | prot */
export function etiquetaIcone(nome, titulo, classe = '') {
  const s = document.createElement('span');
  s.className = ('etiqueta-ico ' + classe).trim();
  s.title = titulo;
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', titulo);
  s.append(icone(nome, 15));
  return s;
}
