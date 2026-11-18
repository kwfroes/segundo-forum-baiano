/**
 * participantes.js — RF008 (consulta), RF009 (histórico) e ações administrativas.
 * CPF é exibido sempre mascarado; a busca por CPF é feita no servidor.
 */
import { iniciarPagina, aviso, confirmar, informar } from './admin-shell.js';
import { el, limpar, debounce, formatarDataHora, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb, ehAdmin } = await iniciarPagina({ requer: 'staff', pagina: 'participantes.html' });

const TAMANHO = 50;
const estado = { ordem: 'nome_completo', direcao: 'asc', offset: 0, total: 0 };

const COLUNAS = [
  { chave: 'nome_completo', rotulo: 'Nome completo' },
  { chave: null, rotulo: 'CPF' },
  { chave: 'inscricao_confirmada', rotulo: 'Inscrição' },
  { chave: 'checkin_data_hora', rotulo: 'Check-in' },
  { chave: null, rotulo: 'Ações' },
  { chave: 'matricula_funcional', rotulo: 'Matrícula' },
  { chave: 'secretaria', rotulo: 'Secretaria' },
  { chave: 'orgao_unidade', rotulo: 'Órgão/unidade' },
  { chave: 'municipio_lotacao', rotulo: 'Município' },
  { chave: 'unidade_gestora', rotulo: 'UG' },
  { chave: 'cargo_funcao', rotulo: 'Cargo/função' },
  { chave: 'area_atuacao', rotulo: 'Área de atuação' },
];

function montarCabecalho() {
  const tr = el('tr');
  COLUNAS.forEach((c) => {
    const th = el('th', { scope: 'col', 'aria-sort': c.chave === estado.ordem ? (estado.direcao === 'asc' ? 'ascending' : 'descending') : null });
    if (c.chave) {
      const seta = c.chave === estado.ordem ? (estado.direcao === 'asc' ? ' ▲' : ' ▼') : '';
      th.append(el('button', { type: 'button', onclick: () => {
        if (estado.ordem === c.chave) estado.direcao = estado.direcao === 'asc' ? 'desc' : 'asc';
        else { estado.ordem = c.chave; estado.direcao = 'asc'; }
        estado.offset = 0; montarCabecalho(); carregar();
      } }, c.rotulo + seta));
    } else th.textContent = c.rotulo;
    tr.append(th);
  });
  const cab = $('cabecalho'); limpar(cab); cab.append(tr);
}

function filtros() {
  return {
    p_busca: $('f-busca').value.trim() || null,
    p_secretaria: $('f-secretaria').value || null,
    p_orgao: $('f-orgao').value || null,
    p_municipio: $('f-municipio').value || null,
    p_inscricao: $('f-inscricao').value,
    p_checkin: $('f-checkin').value,
  };
}

async function carregar() {
  const { data, error } = await sb.rpc('fn_admin_listar_participantes', {
    ...filtros(), p_ordem: estado.ordem, p_direcao: estado.direcao, p_limite: TAMANHO, p_offset: estado.offset,
  });
  if (error) return aviso(mensagemErro(error), 'erro');
  estado.total = data.total;
  const corpo = $('corpo'); limpar(corpo);
  if (!data.itens.length) corpo.append(el('tr', {}, el('td', { colspan: COLUNAS.length, class: 'vazio' }, 'Nenhum participante encontrado.')));
  data.itens.forEach((p) => corpo.append(linha(p)));

  const ini = data.total ? estado.offset + 1 : 0;
  const fim = Math.min(estado.offset + TAMANHO, data.total);
  $('contagem').textContent = `${ini}–${fim} de ${data.total} participante(s)`;
  $('pagina').textContent = ` Página ${Math.floor(estado.offset / TAMANHO) + 1} de ${Math.max(1, Math.ceil(data.total / TAMANHO))} `;
  $('anterior').disabled = estado.offset === 0;
  $('proxima').disabled = estado.offset + TAMANHO >= data.total;
}

function linha(p) {
  const acoes = el('div', { class: 'acoes-tabela' });
  if (p.inscricao_confirmada && !p.presente) acoes.append(el('button', { class: 'btn verde pequeno', type: 'button', onclick: () => checkinManual(p) }, 'Check-in'));
  if (ehAdmin && p.presente) acoes.append(el('button', { class: 'btn perigo pequeno', type: 'button', onclick: () => cancelar(p) }, 'Cancelar'));
  if (ehAdmin) acoes.append(el('button', { class: 'btn sec pequeno', type: 'button', onclick: () => alternarInscricao(p) }, p.inscricao_confirmada ? 'Desconfirmar' : 'Confirmar'));
  acoes.append(el('button', { class: 'btn sec pequeno', type: 'button', onclick: () => historico(p) }, 'Histórico'));

  return el('tr', {},
    el('td', { class: 'nome' }, p.nome_completo),
    el('td', { class: 'mono' }, p.cpf_mascarado || el('span', { class: 'etiqueta ambar' }, 'sem CPF')),
    el('td', {}, el('span', { class: 'etiqueta ' + (p.inscricao_confirmada ? 'verde' : 'ambar') }, p.inscricao_confirmada ? 'Confirmada' : 'Não confirmada')),
    el('td', {}, p.presente
      ? [el('span', { class: 'etiqueta verde' }, 'Presente'), el('br'), el('small', {}, formatarDataHora(p.checkin_data_hora))]
      : el('span', { class: 'etiqueta cinza' }, 'Ausente')),
    el('td', { class: 'col-acoes' }, acoes),
    el('td', { class: 'mono' }, p.matricula_funcional || ''),
    el('td', {}, p.secretaria || ''),
    el('td', {}, p.orgao_unidade || ''),
    el('td', {}, p.municipio_lotacao || ''),
    el('td', {}, p.unidade_gestora || ''),
    el('td', {}, p.cargo_funcao || ''),
    el('td', {}, p.area_atuacao || ''));
}

async function checkinManual(p) {
  const { ok, motivo } = await confirmar({ titulo: 'Check-in administrativo', mensagem: `Registrar a presença de ${p.nome_completo}?`, pedirMotivo: true, textoConfirmar: 'Registrar presença' });
  if (!ok) return;
  const { data, error } = await sb.rpc('fn_admin_checkin_manual', { p_participante_id: p.id, p_observacao: motivo || null });
  if (error) return aviso(mensagemErro(error), 'erro');
  const msgs = { sucesso: ['Presença registrada.', 'ok'], ja_realizado: ['Check-in já realizado anteriormente.', 'alerta'], nao_confirmado: ['Inscrição não confirmada.', 'alerta'], nao_encontrado: ['Participante não encontrado.', 'erro'] };
  const [t, tipo] = msgs[data.status] || ['Resultado inesperado.', 'alerta'];
  aviso(t, tipo); carregar();
}

async function cancelar(p) {
  const { ok, motivo } = await confirmar({ titulo: 'Cancelar check-in', mensagem: `Cancelar o check-in de ${p.nome_completo}? O registro permanece no histórico.`, pedirMotivo: true, motivoObrigatorio: true, textoConfirmar: 'Cancelar check-in', perigo: true });
  if (!ok) return;
  const { error } = await sb.rpc('fn_admin_cancelar_checkin', { p_participante_id: p.id, p_motivo: motivo });
  if (error) return aviso(mensagemErro(error), 'erro');
  aviso('Check-in cancelado.', 'ok'); carregar();
}

async function alternarInscricao(p) {
  const novo = !p.inscricao_confirmada;
  const { ok, motivo } = await confirmar({ titulo: novo ? 'Confirmar inscrição' : 'Remover confirmação', mensagem: novo ? `Confirmar a inscrição de ${p.nome_completo}?` : `Remover a confirmação da inscrição de ${p.nome_completo}? O participante deixará de poder fazer check-in.`, pedirMotivo: true, textoConfirmar: 'Confirmar' });
  if (!ok) return;
  const { error } = await sb.rpc('fn_admin_definir_inscricao', { p_participante_id: p.id, p_confirmada: novo, p_motivo: motivo || null });
  if (error) return aviso(mensagemErro(error), 'erro');
  aviso('Inscrição atualizada.', 'ok'); carregar();
}

async function historico(p) {
  const { data, error } = await sb.rpc('fn_admin_historico', { p_participante_id: p.id, p_limite: 100, p_offset: 0 });
  if (error) return aviso(mensagemErro(error), 'erro');
  const corpo = data.itens.length
    ? el('table', { class: 'dados' },
        el('thead', {}, el('tr', {}, ['Data/hora', 'Origem', 'Registrado por', 'Situação', 'Observações'].map((t) => el('th', {}, t)))),
        el('tbody', {}, data.itens.map((i) => el('tr', {},
          el('td', { class: 'mono' }, formatarDataHora(i.data_hora)),
          el('td', {}, i.metodo === 'publico' ? 'Credenciamento público' : 'Intervenção administrativa'),
          el('td', {}, i.registrado_por),
          el('td', {}, el('span', { class: 'etiqueta ' + (i.status === 'ativo' ? 'verde' : 'vermelha') }, i.status === 'ativo' ? 'Ativo' : 'Cancelado')),
          el('td', {}, i.status === 'cancelado' ? `Cancelado em ${formatarDataHora(i.cancelado_em)} por ${i.cancelado_por_nome || '—'}: ${i.motivo_cancelamento}` : (i.observacao || ''))))))
    : el('p', { class: 'vazio' }, 'Nenhum registro de check-in para este participante.');
  informar({ titulo: `Histórico — ${p.nome_completo}`, corpo, largo: true });
}

/* ------------------------------ Inicialização ------------------------------ */
const { data: f } = await sb.rpc('fn_admin_filtros');
const preencherSelect = (id, valores) => (valores || []).forEach((v) => $(id).append(el('option', { value: v }, v)));
if (f) { preencherSelect('f-secretaria', f.secretarias); preencherSelect('f-orgao', f.orgaos); preencherSelect('f-municipio', f.municipios); }

const recarregar = () => { estado.offset = 0; carregar(); };
$('filtros').addEventListener('submit', (e) => e.preventDefault());
$('f-busca').addEventListener('input', debounce(recarregar, 350));
['f-secretaria', 'f-orgao', 'f-municipio', 'f-inscricao', 'f-checkin'].forEach((id) => $(id).addEventListener('change', recarregar));
$('anterior').addEventListener('click', () => { estado.offset = Math.max(0, estado.offset - TAMANHO); carregar(); });
$('proxima').addEventListener('click', () => { estado.offset += TAMANHO; carregar(); });

montarCabecalho();
await carregar();
