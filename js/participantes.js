/**
 * participantes.js — RF008 (consulta), RF009 (histórico) e ações da equipe.
 *  • Check-in pelo painel: UM CLIQUE, sem justificativa (operador e administrador). Fica na auditoria.
 *  • Check-in duplo: um botão por período (manhã / tarde).
 *  • Incluir participante que não está na base (nome, CPF, e-mail e justificativa obrigatórios; celular opcional).
 *  • Cancelar check-in e confirmar inscrição: somente administrador (com motivo).
 * CPF é exibido sempre mascarado; a busca por CPF é feita no servidor.
 *
 * DESEMPENHO: os filtros e a lista são pedidos AO MESMO TEMPO (antes eram em sequência) e os filtros
 * ficam em cache na aba; respostas antigas (quando se digita rápido na busca) são descartadas.
 */
import { iniciarPagina, aviso, confirmar, informar, abrirDialogo } from './admin-shell.js';
import { el, limpar, debounce, formatarDataHora, formatarHoraCurta, mensagemErro, mascararCpf, cpfValido, somenteDigitos } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb, ehAdmin } = await iniciarPagina({ requer: 'staff', pagina: 'participantes.html' });

const TAMANHO = 50;
const estado = { ordem: 'nome_completo', direcao: 'asc', offset: 0, total: 0, duplo: false, periodoAtual: 'unico' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOME_PERIODO = { manha: 'Manhã', tarde: 'Tarde', unico: 'Único' };
const CHAVE_FILTROS = 'forum-checkin-filtros';
const VALIDADE_FILTROS_MS = 10 * 60 * 1000;
let pedido = 0;                               // número do último pedido da lista (descarta respostas antigas)

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
  { chave: 'analise_srl_saeb', rotulo: 'Análise SRL/SAEB' },
  { chave: 'tipo_inscricao', rotulo: 'Tipo de inscrição' },
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

/** Opções do filtro de check-in: as de período só existem com o check-in duplo ativado. */
function ajustarFiltroCheckin() {
  const sel = $('f-checkin');
  const quer = estado.duplo
    ? [['todos', 'Todos'], ['presente', 'Presente (ao menos 1)'], ['ausente', 'Sem nenhum check-in'], ['manha', 'Presente na manhã'], ['tarde', 'Presente na tarde'], ['ambos', 'Nos dois períodos'], ['so_manha', 'Só manhã'], ['so_tarde', 'Só tarde']]
    : [['todos', 'Todos'], ['presente', 'Presente'], ['ausente', 'Ausente']];
  const atual = [...sel.options].map((o) => o.value).join(',');
  if (atual === quer.map((q) => q[0]).join(',')) return;
  const valor = sel.value;
  limpar(sel);
  quer.forEach(([v, t]) => sel.append(el('option', { value: v }, t)));
  sel.value = quer.some((q) => q[0] === valor) ? valor : 'todos';
}

function atualizarFaixa() {
  const f = $('faixa-periodo');
  const rot = { manha: 'Check-in duplo ativado — agora: manhã', tarde: 'Check-in duplo ativado — agora: tarde', intervalo: 'Check-in duplo ativado — agora: intervalo (o check-in público está fechado; a equipe pode registrar pelo painel)' };
  f.hidden = !(estado.duplo && rot[estado.periodoAtual]);
  f.textContent = rot[estado.periodoAtual] || '';
  f.className = 'aviso-periodo' + (estado.periodoAtual === 'intervalo' ? ' intervalo' : '');
}

async function carregar() {
  const meu = ++pedido;
  const area = $('tabela').closest('.tabela-rolavel');
  area.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('fn_admin_listar_participantes', {
    ...filtros(), p_ordem: estado.ordem, p_direcao: estado.direcao, p_limite: TAMANHO, p_offset: estado.offset,
  });
  if (meu !== pedido) return;                 // o usuário já pediu outra coisa: descarta esta resposta
  area.removeAttribute('aria-busy');
  if (error) return aviso(mensagemErro(error), 'erro');
  estado.total = data.total;
  estado.duplo = data.duplo === true;
  estado.periodoAtual = data.periodo_atual || 'unico';
  ajustarFiltroCheckin(); atualizarFaixa();
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

/* ------------------------- Célula de check-in ------------------------- */
/** Um bloco por período: presente (com horário e, para administrador, ✕ para cancelar) ou botão de registrar. */
function celulaCheckin(p) {
  const blocos = [];
  const bloco = (periodoBanco, rotulo, quando, periodoCancelar, periodoRegistrar) => {
    const linhaEl = el('div', { class: 'periodo-linha' });
    if (rotulo) linhaEl.append(el('span', { class: 'rot' }, rotulo));
    if (quando) {
      linhaEl.append(el('span', { class: 'etiqueta ' + (periodoBanco === 'tarde' ? 'verde' : periodoBanco === 'manha' ? 'azul' : 'verde'), title: formatarDataHora(quando) },
        rotulo ? formatarHoraCurta(quando) : `Presente ${formatarDataHora(quando)}`));
      if (ehAdmin) {
        linhaEl.append(el('button', { class: 'btn-x', type: 'button', title: 'Cancelar este check-in', 'aria-label': `Cancelar check-in${rotulo ? ' da ' + rotulo.toLowerCase() : ''} de ${p.nome_completo}`,
          onclick: () => cancelar(p, periodoCancelar, rotulo) }, '✕'));
      }
    } else if (p.inscricao_confirmada) {
      linhaEl.append(el('button', { class: 'btn verde mini', type: 'button', onclick: () => checkin(p, periodoRegistrar) }, rotulo ? `+ ${rotulo}` : 'Check-in'));
    } else {
      linhaEl.append(el('span', { class: 'etiqueta cinza' }, rotulo ? '—' : 'Ausente'));
    }
    blocos.push(linhaEl);
  };
  if (estado.duplo) {
    bloco('manha', 'Manhã', p.checkin_manha, 'manha', 'manha');
    bloco('tarde', 'Tarde', p.checkin_tarde, 'tarde', 'tarde');
    if (p.checkin_unico) bloco('unico', 'Único', p.checkin_unico, 'unico', 'unico');
  } else {
    // sem check-in duplo: um só bloco; o período é definido pelo servidor
    bloco('unico', null, p.presente ? p.checkin_data_hora : null, null, null);
  }
  return blocos;
}

function linha(p) {
  const acoes = el('div', { class: 'acoes-tabela' });
  if (ehAdmin) acoes.append(el('button', { class: 'btn sec pequeno', type: 'button', onclick: () => alternarInscricao(p) }, p.inscricao_confirmada ? 'Desconfirmar' : 'Confirmar'));
  acoes.append(el('button', { class: 'btn sec pequeno', type: 'button', onclick: () => historico(p) }, 'Histórico'));

  return el('tr', {},
    el('td', { class: 'nome' }, p.nome_completo,
      p.incluido_manual ? el('span', { class: 'etiqueta incluido', title: p.justificativa_inclusao || 'Incluído manualmente' }, ' incluído manualmente') : null),
    el('td', { class: 'mono' }, p.cpf_mascarado || el('span', { class: 'etiqueta ambar' }, 'sem CPF')),
    el('td', {}, el('span', { class: 'etiqueta ' + (p.inscricao_confirmada ? 'verde' : 'ambar') }, p.inscricao_confirmada ? 'Confirmada' : 'Não confirmada')),
    el('td', {}, celulaCheckin(p)),
    el('td', { class: 'col-acoes' }, acoes),
    el('td', { class: 'mono' }, p.matricula_funcional || ''),
    el('td', {}, p.secretaria || ''),
    el('td', {}, p.orgao_unidade || ''),
    el('td', {}, p.municipio_lotacao || ''),
    el('td', {}, p.unidade_gestora || ''),
    el('td', {}, p.cargo_funcao || ''),
    el('td', {}, p.area_atuacao || ''),
    el('td', {}, p.analise_srl_saeb || ''),
    el('td', {}, p.tipo_inscricao || ''));
}

/* ------------------------------ Ações ------------------------------ */
/** Check-in direto: sem diálogo e sem justificativa. */
async function checkin(p, periodo) {
  const { data, error } = await sb.rpc('fn_admin_checkin_manual', { p_participante_id: p.id, p_periodo: periodo || null });
  if (error) return aviso(mensagemErro(error), 'erro');
  const per = NOME_PERIODO[data.periodo] && data.periodo !== 'unico' ? ` (${NOME_PERIODO[data.periodo].toLowerCase()})` : '';
  const msgs = {
    sucesso: [`Check-in registrado${per}: ${p.nome_completo}.`, 'ok'],
    ja_realizado: [`Check-in${per} já realizado anteriormente.`, 'alerta'],
    nao_confirmado: ['Inscrição não confirmada.', 'alerta'],
    nao_encontrado: ['Participante não encontrado.', 'erro'],
    informe_periodo: ['Escolha o período do check-in (manhã ou tarde).', 'alerta'],
    periodo_invalido: ['Período inválido para a configuração atual. Atualize a página.', 'erro'],
  };
  const [t, tipo] = msgs[data.status] || ['Resultado inesperado.', 'alerta'];
  aviso(t, tipo); carregar();
}

async function cancelar(p, periodo, rotulo) {
  const { ok, motivo } = await confirmar({
    titulo: 'Cancelar check-in',
    mensagem: `Cancelar o check-in${rotulo ? ' da ' + rotulo.toLowerCase() : ''} de ${p.nome_completo}? O registro permanece no histórico.`,
    pedirMotivo: true, motivoObrigatorio: true, textoConfirmar: 'Cancelar check-in', perigo: true });
  if (!ok) return;
  const { data, error } = await sb.rpc('fn_admin_cancelar_checkin', { p_participante_id: p.id, p_motivo: motivo, p_periodo: periodo || null });
  if (error) return aviso(mensagemErro(error), 'erro');
  if (data.status === 'informe_periodo') return aviso('Há check-ins em mais de um período. Ative o check-in duplo para cancelar cada um individualmente.', 'alerta');
  if (data.status !== 'sucesso') return aviso('Nenhum check-in ativo para cancelar.', 'alerta');
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
        el('thead', {}, el('tr', {}, ['Data/hora', 'Período', 'Origem', 'Registrado por', 'Situação', 'Observações'].map((t) => el('th', {}, t)))),
        el('tbody', {}, data.itens.map((i) => el('tr', {},
          el('td', { class: 'mono' }, formatarDataHora(i.data_hora)),
          el('td', {}, NOME_PERIODO[i.periodo] || ''),
          el('td', {}, i.metodo === 'publico' ? 'Credenciamento público' : 'Intervenção administrativa'),
          el('td', {}, i.registrado_por),
          el('td', {}, el('span', { class: 'etiqueta ' + (i.status === 'ativo' ? 'verde' : 'vermelha') }, i.status === 'ativo' ? 'Ativo' : 'Cancelado')),
          el('td', {}, i.status === 'cancelado' ? `Cancelado em ${formatarDataHora(i.cancelado_em)} por ${i.cancelado_por_nome || '—'}: ${i.motivo_cancelamento}` : (i.observacao || ''))))))
    : el('p', { class: 'vazio' }, 'Nenhum registro de check-in para este participante.');
  informar({ titulo: `Histórico — ${p.nome_completo}`, corpo, largo: true });
}

/* ----------------- Incluir participante que não está na base ----------------- */
/** Mantém o diálogo aberto mostrando o erro até dar certo ou o usuário cancelar. */
async function formulario({ titulo, corpo, textoConfirmar, aoConfirmar }) {
  const msg = el('p', { class: 'msg erro', role: 'alert', hidden: true });
  for (;;) {
    const r = await abrirDialogo({
      titulo, corpo: el('div', { class: 'dlg-form' }, corpo, msg),
      botoes: [{ rotulo: 'Cancelar', valor: 'nao', classe: 'sec' }, { rotulo: textoConfirmar, valor: 'sim' }],
    });
    if (r !== 'sim') return false;
    const falha = await aoConfirmar();
    if (!falha) return true;
    msg.textContent = falha; msg.hidden = false;
  }
}

async function adicionar() {
  const nome = el('input', { type: 'text', maxlength: 200, autocomplete: 'off', 'aria-label': 'Nome completo' });
  const cpf = el('input', { type: 'text', inputmode: 'numeric', maxlength: 14, autocomplete: 'off', placeholder: '000.000.000-00', 'aria-label': 'CPF' });
  cpf.addEventListener('input', () => { cpf.value = mascararCpf(cpf.value); });
  const email = el('input', { type: 'email', maxlength: 200, autocomplete: 'off', 'aria-label': 'E-mail' });
  const cel = el('input', { type: 'tel', maxlength: 30, autocomplete: 'off', placeholder: '(71) 90000-0000', 'aria-label': 'Celular' });
  const just = el('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Justificativa', placeholder: 'Por que este participante não está na base?' });
  const reg = el('input', { type: 'checkbox', checked: true, id: 'chk-registrar', 'aria-label': 'Registrar check-in agora' });
  const selPeriodo = el('select', { 'aria-label': 'Período do check-in' },
    el('option', { value: 'manha' }, 'Manhã'), el('option', { value: 'tarde' }, 'Tarde'));
  selPeriodo.value = estado.periodoAtual === 'manha' ? 'manha' : 'tarde';
  const blocoPeriodo = el('div', { class: 'campo', hidden: !estado.duplo }, el('label', {}, 'Período do check-in'), selPeriodo);
  reg.addEventListener('change', () => { blocoPeriodo.hidden = !(estado.duplo && reg.checked); });
  blocoPeriodo.hidden = !(estado.duplo && reg.checked);

  const dupLista = el('ul'); const dupChk = el('input', { type: 'checkbox', id: 'chk-duplicidade', 'aria-label': 'Confirmo que é outra pessoa' });
  const dupBloco = el('div', { class: 'dup', hidden: true },
    el('strong', {}, 'Já existe cadastro com este e-mail ou nome:'), dupLista,
    el('p', { class: 'nota' }, 'Se for a mesma pessoa, cancele e use a busca para fazer o check-in dela.'),
    el('label', {}, dupChk, 'Confirmo que é outra pessoa'));

  let resultado = null;
  const ok = await formulario({
    titulo: 'Adicionar participante', textoConfirmar: 'Adicionar',
    corpo: [
      el('p', { class: 'nota' }, 'Para quem não está na base importada. Campos com * são obrigatórios.'),
      el('div', { class: 'campo' }, el('label', {}, 'Nome completo *'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'CPF *'), cpf),
      el('div', { class: 'campo' }, el('label', {}, 'E-mail *'), email),
      el('div', { class: 'campo' }, el('label', {}, 'Celular (opcional)'), cel),
      el('div', { class: 'campo' }, el('label', {}, 'Justificativa *'), just),
      el('div', { class: 'linha-check' }, reg, el('label', { for: 'chk-registrar' }, 'Registrar o check-in agora')),
      blocoPeriodo, dupBloco,
    ],
    aoConfirmar: async () => {
      const n = nome.value.replace(/\s+/g, ' ').trim();
      if (n.length < 3) return 'Informe o nome completo.';
      if (!cpfValido(cpf.value)) return 'CPF inválido. Confira os números.';
      if (!EMAIL_RE.test(email.value.trim())) return 'Informe um e-mail válido.';
      const c = cel.value.trim();
      if (c && !/^[0-9+() -]{8,30}$/.test(c)) return 'Celular inválido. Use apenas números, espaços, parênteses, + e -.';
      if (just.value.trim().length < 5) return 'Informe a justificativa (mínimo de 5 caracteres).';

      const { data, error } = await sb.rpc('fn_admin_adicionar_participante', {
        p_nome: n, p_cpf: somenteDigitos(cpf.value), p_email: email.value.trim(), p_justificativa: just.value.trim(),
        p_celular: c || null, p_registrar_checkin: reg.checked,
        p_periodo: estado.duplo && reg.checked ? selPeriodo.value : null,
        p_confirmar_duplicidade: dupChk.checked,
      });
      if (error) return mensagemErro(error);
      switch (data.status) {
        case 'sucesso': resultado = data; return null;
        case 'cpf_invalido': return 'CPF inválido. Confira os números.';
        case 'dados_invalidos': return data.mensagem || 'Dados inválidos.';
        case 'cpf_existente': return `Este CPF já está na base (${data.nome}). Feche esta janela e use a busca para fazer o check-in dele.`;
        case 'possivel_duplicado':
          limpar(dupLista);
          (data.candidatos || []).forEach((c) => dupLista.append(el('li', {},
            `${c.nome} — ${c.tem_cpf ? c.cpf_mascarado : 'sem CPF'}${c.secretaria ? ' — ' + c.secretaria : ''}${c.email_institucional ? ' — ' + c.email_institucional : ''}`)));
          dupBloco.hidden = false;
          return 'Confira se esta pessoa já está na base. Se for outra pessoa, marque a confirmação e envie novamente.';
        case 'informe_periodo': return 'Escolha o período do check-in.';
        default: return 'Não foi possível adicionar o participante.';
      }
    },
  });
  if (!ok || !resultado) return;
  const per = resultado.checkin && estado.duplo ? ` (${NOME_PERIODO[resultado.periodo].toLowerCase()})` : '';
  aviso(`${resultado.nome} adicionado${resultado.checkin ? ' e check-in registrado' + per : ''}.`, 'ok');
  carregar();
}

/* ------------------------------ Filtros (com cache) ------------------------------ */
/** Preenche os três filtros preservando a escolha atual. Pode ser chamado de novo quando chega a versão atualizada. */
function preencherFiltros(f) {
  [['f-secretaria', 'secretarias'], ['f-orgao', 'orgaos'], ['f-municipio', 'municipios']].forEach(([id, chave]) => {
    const sel = $(id); const escolhido = sel.value; const valores = f[chave] || [];
    while (sel.options.length > 1) sel.remove(1);
    valores.forEach((v) => sel.append(el('option', { value: v }, v)));
    sel.value = valores.includes(escolhido) ? escolhido : '';
  });
}

async function carregarFiltros() {
  try {   // mostra na hora a última lista conhecida (mesma aba)…
    const c = JSON.parse(sessionStorage.getItem(CHAVE_FILTROS) || 'null');
    if (c && Date.now() - c.t < VALIDADE_FILTROS_MS) preencherFiltros(c.dados);
  } catch { /* sem cache */ }
  const { data } = await sb.rpc('fn_admin_filtros');   // …e atualiza com a versão do banco
  if (data) {
    preencherFiltros(data);
    try { sessionStorage.setItem(CHAVE_FILTROS, JSON.stringify({ t: Date.now(), dados: data })); } catch { /* sem cache */ }
  }
}

/* ------------------------------ Inicialização ------------------------------ */
const recarregar = () => { estado.offset = 0; carregar(); };
$('filtros').addEventListener('submit', (e) => e.preventDefault());
$('f-busca').addEventListener('input', debounce(recarregar, 350));
['f-secretaria', 'f-orgao', 'f-municipio', 'f-inscricao', 'f-checkin'].forEach((id) => $(id).addEventListener('change', recarregar));
$('anterior').addEventListener('click', () => { estado.offset = Math.max(0, estado.offset - TAMANHO); carregar(); });
$('proxima').addEventListener('click', () => { estado.offset += TAMANHO; carregar(); });
$('adicionar').addEventListener('click', adicionar);

montarCabecalho();
$('corpo').append(el('tr', {}, el('td', { colspan: COLUNAS.length, class: 'vazio' }, 'Carregando participantes…')));
// Filtros e lista saem juntos: o tempo total é o de UMA consulta, não a soma das duas.
await Promise.all([carregarFiltros().catch(() => {}), carregar()]);
