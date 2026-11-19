/**
 * logs.js — página de LOGS (trilha de auditoria). Somente leitura e somente para o usuário MASTER.
 *  • A regra de acesso está em três lugares: o menu (admin-shell.js), o redirecionamento da página (admin-shell.js) e o banco
 *    (as funções fn_admin_auditoria_* exigem administrador ativo + app_metadata.master = true no login).
 *  • Tudo é desenhado com textContent (nunca innerHTML): os detalhes do log podem conter texto digitado por usuários.
 *  • Ações desconhecidas aparecem com o nome "legível" gerado a partir do código, então logs novos nunca ficam em branco.
 */
import { iniciarPagina, aviso, informar } from './admin-shell.js';
import { botaoIcone, soIcone } from './icones.js';
import { el, limpar, debounce, formatarDataHora, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb } = await iniciarPagina({ requer: 'admin' });

const TAMANHO = 50;
const estado = { offset: 0, total: 0 };
let pedido = 0;                                    // descarta respostas antigas quando os filtros mudam depressa

/* ----------------------------- Rótulos ----------------------------- */
// [texto, estilo]: ambar = dado sensível, vermelha = tentativa bloqueada, verde = criação, cinza = o restante
const ACOES = {
  cpf_exibido: ['CPF completo exibido', 'ambar'],
  participantes_exportados: ['Participantes exportados (CSV)', 'ambar'],
  acesso_enviado_email: ['Acesso enviado por e-mail', 'ambar'],
  usuario_protegido_tentativa: ['Tentativa em usuário protegido', 'vermelha'],
  participante_incluido: ['Participante incluído', 'verde'],
  participante_editado: ['Participante editado', 'cinza'],
  config_alterada: ['Configuração alterada', 'cinza'],
  usuario_criado: ['Usuário criado', 'verde'],
  usuario_alterado: ['Usuário alterado', 'cinza'],
  senha_redefinida: ['Senha redefinida', 'ambar'],
};
const humaniza = (codigo) => { const t = String(codigo ?? '').replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : '—'; };
const rotuloAcao = (codigo) => (ACOES[codigo] ? ACOES[codigo][0] : humaniza(codigo));
const estiloAcao = (codigo) => (ACOES[codigo] ? ACOES[codigo][1] : 'cinza');

const CHAVES = {
  usuario: 'Usuário (alvo)', quantidade: 'Quantidade', perfil: 'Perfil', resultado: 'Resultado', cpf_completo: 'CPF completo',
  com_filtros: 'Com filtros', justificativa: 'Justificativa', identificacao: 'Identificação', checkin: 'Check-in', periodo: 'Período',
  duplicidade_confirmada: 'Duplicidade confirmada', chave: 'Configuração', operacao: 'Operação', nome: 'Nome', campos: 'Campos',
  de: 'De', para: 'Para', cpf: 'CPF', motivo: 'Motivo', arquivo: 'Arquivo',
};
const rotuloChave = (k) => CHAVES[k] ?? humaniza(k);

function valor(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) return v.length ? v.map(valor).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Transforma o JSON dos detalhes em linhas [rótulo, texto]. Objetos { de, para } viram "de → para". */
function achatar(obj, prefixo = '', saida = [], nivel = 0) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const nome = prefixo ? `${prefixo} › ${rotuloChave(k)}` : rotuloChave(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const chaves = Object.keys(v);
      if (chaves.length === 2 && 'de' in v && 'para' in v) saida.push([nome, `${valor(v.de)} → ${valor(v.para)}`]);
      else if (nivel < 3) achatar(v, nome, saida, nivel + 1);
      else saida.push([nome, JSON.stringify(v)]);
    } else saida.push([nome, valor(v)]);
  }
  return saida;
}

/** Linhas dos detalhes, trocando o id do usuário-alvo pelo nome (o banco devolve "alvo_nome"). */
function linhasDetalhe(item, comId = false) {
  const d = { ...(item.detalhes ?? {}) };
  if (item.alvo_nome && typeof d.usuario === 'string') d.usuario = comId ? `${item.alvo_nome} (${d.usuario})` : item.alvo_nome;
  return achatar(d);
}
const resumo = (item) => linhasDetalhe(item).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ');
const quemFez = (i) => i.usuario_nome || (i.usuario_id ? `Usuário ${String(i.usuario_id).slice(0, 8)}…` : 'Sistema');

/* ----------------------------- Lista ----------------------------- */
function filtros() {
  return {
    p_de: $('f-de').value || null, p_ate: $('f-ate').value || null,
    p_acao: $('f-acao').value || null, p_usuario: $('f-usuario').value || null,
    p_busca: $('f-busca').value.trim() || null,
  };
}

function mensagemDeFalha(erro) {
  if (erro?.code === 'PGRST202' || /Could not find the function/i.test(erro?.message ?? '')) {
    return 'As funções de logs ainda não existem no banco. Rode o 15_card_participantes_e_logs.sql no SQL Editor do Supabase.';
  }
  if (erro?.code === '42501') return 'Acesso negado: esta página é só do usuário master. Se a marca master foi dada agora, saia do painel e entre de novo.';
  return mensagemErro(erro);
}

function linha(i) {
  const texto = resumo(i);
  return el('tr', {},
    el('td', { class: 'mono' }, formatarDataHora(i.data_hora)),
    el('td', {}, quemFez(i)),
    el('td', {}, el('span', { class: 'etiqueta ' + estiloAcao(i.acao), title: i.acao }, rotuloAcao(i.acao))),
    el('td', {}, texto ? el('span', { class: 'log-resumo', title: texto.slice(0, 600) }, texto) : el('span', { class: 'nota' }, '—')),
    el('td', {}, botaoIcone({ icone: 'olho', titulo: 'Ver detalhes', rotuloAria: `Ver detalhes do registro de ${formatarDataHora(i.data_hora)}`, onclick: () => detalhes(i) })));
}

async function carregar() {
  const f = filtros();
  if (f.p_de && f.p_ate && f.p_de > f.p_ate) return aviso('A data inicial não pode ser depois da data final.', 'erro');
  const meu = ++pedido;
  const area = $('tabela').closest('.tabela-rolavel');
  area.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('fn_admin_auditoria_listar', { ...f, p_limite: TAMANHO, p_offset: estado.offset });
  if (meu !== pedido) return;
  area.removeAttribute('aria-busy');
  const corpo = $('corpo'); limpar(corpo);
  if (error) {
    corpo.append(el('tr', {}, el('td', { colspan: 5, class: 'vazio' }, 'Não foi possível carregar os logs.')));
    $('contagem').textContent = ''; $('anterior').disabled = true; $('proxima').disabled = true;
    return aviso(mensagemDeFalha(error), 'erro');
  }
  estado.total = Number(data.total) || 0;
  if (!data.itens.length) corpo.append(el('tr', {}, el('td', { colspan: 5, class: 'vazio' }, 'Nenhum registro encontrado com estes filtros.')));
  data.itens.forEach((i) => corpo.append(linha(i)));
  const ini = estado.total ? estado.offset + 1 : 0;
  const fim = Math.min(estado.offset + TAMANHO, estado.total);
  $('contagem').textContent = `${ini.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${estado.total.toLocaleString('pt-BR')} registro(s)`;
  $('pagina').textContent = ` Página ${Math.floor(estado.offset / TAMANHO) + 1} de ${Math.max(1, Math.ceil(estado.total / TAMANHO))} `;
  $('anterior').disabled = estado.offset === 0;
  $('proxima').disabled = estado.offset + TAMANHO >= estado.total;
}

/* ----------------------------- Detalhes ----------------------------- */
function detalhes(i) {
  const par = (rot, txt) => [el('dt', {}, rot), el('dd', {}, txt)];
  const geral = [
    ...par('Data e hora', formatarDataHora(i.data_hora)),
    ...par('Usuário', i.usuario_nome ? `${i.usuario_nome} (${i.usuario_id})` : quemFez(i)),
    ...par('Ação', `${rotuloAcao(i.acao)} (${i.acao})`),
    ...(i.tabela_afetada ? par('Tabela', i.tabela_afetada) : []),
    ...(i.registro_id ? par('Registro', i.registro_id) : []),
    ...par('Código do log', i.id),
  ];
  const linhas = linhasDetalhe(i, true);
  informar({
    titulo: 'Detalhes do registro',
    largo: true,
    corpo: el('div', { class: 'log-detalhe' },
      el('dl', {}, ...geral),
      el('h3', {}, 'O que foi registrado'),
      linhas.length ? el('dl', {}, ...linhas.flatMap(([k, v]) => par(k, v))) : el('p', { class: 'nota' }, 'Sem detalhes adicionais.')),
  });
}

/* ----------------------------- Filtros e início ----------------------------- */
async function carregarFiltros() {
  const { data } = await sb.rpc('fn_admin_auditoria_filtros');
  if (!data) return;
  (data.acoes ?? []).forEach((a) => $('f-acao').append(el('option', { value: a }, rotuloAcao(a))));
  (data.usuarios ?? []).forEach((u) => $('f-usuario').append(el('option', { value: u.id }, u.nome)));
}

const recarregar = () => { estado.offset = 0; carregar(); };
$('filtros').addEventListener('submit', (e) => e.preventDefault());
['f-de', 'f-ate', 'f-acao', 'f-usuario'].forEach((id) => $(id).addEventListener('change', recarregar));
$('f-busca').addEventListener('input', debounce(recarregar, 400));
$('anterior').addEventListener('click', () => { estado.offset = Math.max(0, estado.offset - TAMANHO); carregar(); });
$('proxima').addEventListener('click', () => { estado.offset += TAMANHO; carregar(); });
soIcone($('anterior'), 'esq', 'Página anterior');
soIcone($('proxima'), 'dir', 'Próxima página');

$('corpo').append(el('tr', {}, el('td', { colspan: 5, class: 'vazio' }, 'Carregando logs…')));
await Promise.all([carregarFiltros().catch(() => {}), carregar()]);
