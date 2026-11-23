/**
 * participantes.js — RF008 (consulta), RF009 (histórico) e ações da equipe.
 *  • Check-in pelo painel: UM CLIQUE, sem justificativa (operador e administrador). Fica na auditoria.
 *  • Check-in duplo: um botão por período (manhã / tarde).
 *  • Incluir participante que não está na base (nome, CPF, e-mail, identificação e justificativa obrigatórios; celular opcional).
 *    A identificação (Participante, Palestrante/Painelista, Convidado, Estandista ou Produção) é gravada na coluna
 *    Análise SRL/SAEB e conta como aprovado.
 *  • Editar dados do participante: o operador altera NOME e CPF; o administrador altera QUALQUER dado cadastral.
 *    (O banco valida o perfil de novo; o CPF aparece sempre mascarado e toda alteração fica na auditoria.)
 *  • Cancelar check-in e confirmar inscrição: somente administrador (com motivo).
 *  • Botões só com ícone (title + aria-label); textos longos da tabela em uma linha, com o texto completo ao passar o mouse.
 *    O NOME do participante nunca é cortado.
 *  • EQUIPE DO EVENTO (palestrantes/painelistas, convidados, estandistas e produção): as linhas ficam em destaque, com a
 *    categoria ao lado do nome, e há o filtro "Equipe". A categoria vem do banco (a partir da coluna Análise SRL/SAEB).
 *  • FILTRO "Inscrição": a tela abre com "Confirmada" selecionada (o administrador pode escolher "Todas").
 *  • CPF COMPLETO (somente administrador): botão "Mostrar CPF". O CPF só chega do banco depois da confirmação, cada
 *    exibição fica na auditoria (apenas a quantidade) e os CPFs voltam a ser ocultados sozinhos em 5 minutos.
 *  • DOWNLOAD DE CSV (somente administrador): lista completa ou somente o que está filtrado na tela, com ou sem CPF completo
 *    (o CPF completo exige confirmação e fica na auditoria). A montagem do arquivo é feita no banco, com os mesmos filtros.
 * CPF é exibido sempre mascarado por padrão; a busca por CPF é feita no servidor.
 *
 * DESEMPENHO: os filtros e a lista são pedidos AO MESMO TEMPO (antes eram em sequência) e os filtros
 * ficam em cache na aba; respostas antigas (quando se digita rápido na busca) são descartadas.
 */
import { iniciarPagina, aviso, confirmar, informar, abrirDialogo } from './admin-shell.js';
import { botaoIcone, soIcone, comIcone, etiquetaIcone } from './icones.js';
import { el, limpar, debounce, formatarDataHora, formatarHoraCurta, mensagemErro, mascararCpf, cpfValido, somenteDigitos, gerarCsv, baixarArquivo } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb, ehAdmin, ehMaster } = await iniciarPagina({ requer: 'staff', pagina: 'participantes.html' });

const TAMANHO = 50;
const estado = { ordem: 'nome_completo', direcao: 'asc', offset: 0, total: 0, duplo: false, periodoAtual: 'unico' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOME_PERIODO = { manha: 'Manhã', tarde: 'Tarde', unico: 'Único' };
// Identificação de quem é incluído manualmente (o banco grava na coluna Análise SRL/SAEB: Participante = SIM).
const CATEGORIAS = [
  ['participante', 'Participante'],
  ['palestrante_painelista', 'Palestrante/Painelista'],
  ['convidado', 'Convidado'],
  ['estandista', 'Estandista'],
  ['producao', 'Produção'],
];
// Categorias da equipe, como o banco as devolve no campo "equipe" de cada participante.
const EQUIPE = {
  palestrante_painelista: 'Palestrante/Painelista',
  convidado: 'Convidado',
  estandista: 'Estandista',
  producao: 'Produção',
};
const CHAVE_FILTROS = 'forum-checkin-filtros';
const VALIDADE_FILTROS_MS = 10 * 60 * 1000;
const CPF_VISIVEL_MS = 5 * 60 * 1000;          // depois disso os CPFs voltam a ser ocultados
let pedido = 0;                               // número do último pedido da lista (descarta respostas antigas)
let itensAtuais = [];                         // participantes da página que está na tela
const cpfs = { visivel: false, timer: null };

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
    p_equipe: $('f-equipe').value,
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
  itensAtuais = data.itens;
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
  if (cpfs.visivel) await mostrarCpfs(meu);   // o botão "Mostrar CPF" continua valendo nas outras páginas e filtros
}

/* ------------------------- Célula de check-in ------------------------- */
/** Um bloco por período: presente (com horário e, para administrador, ✕ para cancelar) ou botão de registrar. */
function celulaCheckin(p) {
  const blocos = [];
  const bloco = (periodoBanco, rotulo, quando, periodoCancelar, periodoRegistrar) => {
    const linhaEl = el('div', { class: 'periodo-linha' });
    const dePeriodo = rotulo ? ` da ${rotulo.toLowerCase()}` : '';        // "Manhã" já aparece ao lado: o botão só diz "Check-in"
    if (rotulo) linhaEl.append(el('span', { class: 'rot' }, rotulo));
    if (quando) {
      linhaEl.append(el('span', { class: 'etiqueta ' + (periodoBanco === 'tarde' ? 'verde' : periodoBanco === 'manha' ? 'azul' : 'verde'), title: formatarDataHora(quando) },
        rotulo ? formatarHoraCurta(quando) : `Presente ${formatarDataHora(quando)}`));
      if (ehAdmin) {
        linhaEl.append(botaoIcone({ icone: 'fechar', titulo: `Cancelar check-in${dePeriodo}`, rotuloAria: `Cancelar check-in${dePeriodo} de ${p.nome_completo}`,
          classe: 'perigo mini', tam: 16, onclick: () => cancelar(p, periodoCancelar, rotulo) }));
      }
    } else if (p.inscricao_confirmada) {
      linhaEl.append(el('button', { class: 'btn verde mini', type: 'button', title: `Registrar check-in${dePeriodo}`,
        'aria-label': `Registrar check-in${dePeriodo} de ${p.nome_completo}`, onclick: () => checkin(p, periodoRegistrar) }, 'Check-in'));
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

/** Texto longo em UMA linha, com reticências; o conteúdo completo aparece ao passar o mouse. */
const trunca = (valor, tamanho = 'media') => (valor ? el('span', { class: 'trunca ' + tamanho, title: valor }, valor) : '');

function linha(p) {
  const acoes = el('div', { class: 'acoes-tabela' });
  acoes.append(botaoIcone({ icone: 'editar', titulo: 'Editar dados', rotuloAria: `Editar dados de ${p.nome_completo}`, onclick: () => editar(p) }));
  if (ehAdmin) acoes.append(el('button', { class: 'btn sec pequeno', type: 'button', onclick: () => alternarInscricao(p) }, p.inscricao_confirmada ? 'Desconfirmar' : 'Confirmar'));
  acoes.append(botaoIcone({ icone: 'historico', titulo: 'Histórico de check-ins', rotuloAria: `Histórico de check-ins de ${p.nome_completo}`, onclick: () => historico(p) }));
  if (ehMaster) {
    const temCheckin = Boolean(p.presente || p.checkin_manha || p.checkin_tarde || p.checkin_unico);
    const btnExcluir = botaoIcone({
      icone: 'lixeira',
      titulo: 'Excluir participante',
      rotuloAria: `Excluir ${p.nome_completo}`,
      classe: 'perigo',
      desabilitado: temCheckin,
      onclick: () => excluir(p),
    });
    acoes.append(temCheckin
      ? el('span', { class: 'bloqueado', title: 'Participantes com check-in registrado não podem ser excluídos.' }, btnExcluir)
      : btnExcluir);
  }

  const equipe = EQUIPE[p.equipe] ? p.equipe : null;           // só categorias conhecidas ganham destaque
  return el('tr', { class: equipe ? 'equipe equipe-' + equipe : null },
    // o NOME fica sempre inteiro (quebra de linha, nunca reticências); a categoria da equipe vem logo depois dele
    el('td', { class: 'nome' }, p.nome_completo,
      equipe ? el('span', { class: 'etiqueta equipe', title: 'Equipe do evento: ' + EQUIPE[equipe] }, EQUIPE[equipe]) : null,
      p.incluido_manual ? etiquetaIcone('user-plus', 'Incluído manualmente' + (p.justificativa_inclusao ? ': ' + p.justificativa_inclusao : ''), 'incl') : null),
    // CPF: mascarado; o botão "Mostrar CPF" (administrador) troca o texto desta célula pelo CPF completo
    el('td', { class: 'mono cpf', 'data-id': p.tem_cpf ? p.id : null, 'data-mascara': p.cpf_mascarado || null }, p.cpf_mascarado || el('span', { class: 'etiqueta ambar' }, 'sem CPF')),
    el('td', {}, etiquetaIcone(p.inscricao_confirmada ? 'confirmar' : 'desconf', p.inscricao_confirmada ? 'Inscrição confirmada' : 'Inscrição não confirmada', p.inscricao_confirmada ? 'verde' : 'ambar')),
    el('td', {}, celulaCheckin(p)),
    el('td', { class: 'col-acoes' }, acoes),
    el('td', { class: 'mono' }, p.matricula_funcional || ''),
    el('td', {}, trunca(p.secretaria, 'curta')),
    el('td', {}, trunca(p.orgao_unidade, 'longa')),
    el('td', {}, trunca(p.municipio_lotacao, 'media')),
    el('td', {}, p.unidade_gestora || ''),
    el('td', {}, trunca(p.cargo_funcao, 'media')),
    el('td', {}, trunca(p.area_atuacao, 'media')),
    el('td', {}, trunca(p.analise_srl_saeb, 'curta')),
    el('td', {}, trunca(p.tipo_inscricao, 'curta')));
}

/* ------------------------------ CPF completo (administrador) ------------------------------ */
function atualizarBotaoCpf() {
  const b = $('cpf-toggle');
  comIcone(b, cpfs.visivel ? 'olho-off' : 'olho', cpfs.visivel ? 'Ocultar CPF' : 'Mostrar CPF');
  b.setAttribute('aria-pressed', cpfs.visivel ? 'true' : 'false');
  b.title = cpfs.visivel ? 'Voltar a ocultar os CPFs' : 'Mostrar o CPF completo desta lista';
}

/** Pede ao banco os CPFs completos da página que está na tela e troca o texto das células. */
async function mostrarCpfs(meu) {
  const ids = itensAtuais.filter((p) => p.tem_cpf).map((p) => p.id);
  if (!cpfs.visivel || !ids.length) return;
  const { data, error } = await sb.rpc('fn_admin_cpfs_completos', { p_ids: ids });
  if (meu !== undefined && meu !== pedido) return;          // a lista mudou enquanto isso: descarta
  if (error) { ocultarCpfs(); return aviso(mensagemErro(error), 'erro'); }
  document.querySelectorAll('#corpo td.cpf[data-id]').forEach((td) => {
    const v = data?.[td.dataset.id];
    if (v) { td.textContent = mascararCpf(v); td.setAttribute('data-revelado', '1'); }
  });
}

function ocultarCpfs() {
  clearTimeout(cpfs.timer); cpfs.visivel = false; atualizarBotaoCpf();
  document.querySelectorAll('#corpo td.cpf[data-revelado]').forEach((td) => { td.textContent = td.dataset.mascara || ''; td.removeAttribute('data-revelado'); });
}

async function alternarCpfs() {
  if (cpfs.visivel) return ocultarCpfs();
  const { ok } = await confirmar({
    titulo: 'Mostrar CPF completo',
    mensagem: ['Os CPFs completos desta lista serão exibidos na tela (dado pessoal). Use apenas para finalidade legítima e não compartilhe a tela.',
      'Os CPFs voltam a ser ocultados sozinhos em 5 minutos ou ao clicar em “Ocultar CPF”.'],
    textoConfirmar: 'Mostrar CPF',
  });
  if (!ok) return;
  cpfs.visivel = true; atualizarBotaoCpf();
  cpfs.timer = setTimeout(() => { if (cpfs.visivel) { ocultarCpfs(); aviso('Os CPFs foram ocultados novamente (5 minutos).', 'info'); } }, CPF_VISIVEL_MS);
  await mostrarCpfs(pedido);
}

/* ------------------------------ Download de CSV (administrador) ------------------------------ */
const sim = (b) => (b ? 'Sim' : 'Não');
const cpfCsv = (v) => (/^\d{11}$/.test(String(v ?? '')) ? mascararCpf(v) : (v ?? ''));    // com pontuação: o Excel não come os zeros
const COLUNAS_CSV = [
  { titulo: 'Nome completo', valor: (r) => r.nome_completo },
  { titulo: 'CPF', valor: (r) => cpfCsv(r.cpf) },
  { titulo: 'Matrícula funcional', valor: (r) => r.matricula_funcional ?? '' },
  { titulo: 'Órgão/unidade', valor: (r) => r.orgao_unidade ?? '' },
  { titulo: 'Secretaria', valor: (r) => r.secretaria ?? '' },
  { titulo: 'Unidade gestora', valor: (r) => r.unidade_gestora ?? '' },
  { titulo: 'Nome da unidade', valor: (r) => r.nome_unidade ?? '' },
  { titulo: 'Município de lotação', valor: (r) => r.municipio_lotacao ?? '' },
  { titulo: 'Cargo/função', valor: (r) => r.cargo_funcao ?? '' },
  { titulo: 'Área de atuação', valor: (r) => r.area_atuacao ?? '' },
  { titulo: 'Tipo de inscrição', valor: (r) => r.tipo_inscricao ?? '' },
  { titulo: 'Análise SRL/SAEB', valor: (r) => r.analise_srl_saeb ?? '' },
  { titulo: 'Equipe', valor: (r) => EQUIPE[r.equipe] ?? '' },
  { titulo: 'Justificativa da inclusão manual', valor: (r) => r.justificativa_inclusao ?? '' },
  { titulo: 'Inscrição confirmada', valor: (r) => sim(r.inscricao_confirmada) },
  { titulo: 'Presente (ao menos 1 check-in)', valor: (r) => sim(r.presente) },
  { titulo: 'Check-in da manhã', valor: (r) => formatarDataHora(r.checkin_manha) },
  { titulo: 'Check-in da tarde', valor: (r) => formatarDataHora(r.checkin_tarde) },
  { titulo: 'Check-in (período único)', valor: (r) => formatarDataHora(r.checkin_unico) },
  { titulo: 'Origem do primeiro check-in', valor: (r) => (r.checkin_metodo === 'publico' ? 'Credenciamento público' : r.checkin_metodo === 'administrativo' ? 'Administrativo' : '') },
];

/** Descrição dos filtros que estão na tela (só o que foge do padrão "todos"). */
function descreverFiltros() {
  const partes = [];
  const busca = $('f-busca').value.trim();
  if (busca) partes.push(`busca “${busca}”`);
  [['f-secretaria', 'Secretaria'], ['f-orgao', 'Órgão/unidade'], ['f-municipio', 'Município'], ['f-inscricao', 'Inscrição'], ['f-checkin', 'Check-in'], ['f-equipe', 'Equipe']].forEach(([id, rotulo]) => {
    const sel = $(id);
    if (!['', 'todos', 'todas'].includes(sel.value)) partes.push(`${rotulo}: ${sel.selectedOptions[0]?.textContent ?? sel.value}`);
  });
  return partes;
}

async function baixarCsv() {
  const partes = descreverFiltros();
  const escFiltro = el('input', { type: 'radio', name: 'escopo', id: 'esc-filtro', value: 'filtro', checked: true });
  const escTotal = el('input', { type: 'radio', name: 'escopo', id: 'esc-total', value: 'total' });
  const cpfChk = el('input', { type: 'checkbox', id: 'csv-cpf' });
  const corpo = el('div', { class: 'dlg-form' },
    el('label', { class: 'opcao-csv', for: 'esc-filtro' }, escFiltro, el('span', {},
      el('strong', {}, 'Somente o que está na tela'),
      el('small', {}, `${estado.total.toLocaleString('pt-BR')} participante(s). Filtros: ${partes.length ? partes.join(' · ') : 'nenhum'}.`))),
    el('label', { class: 'opcao-csv', for: 'esc-total' }, escTotal, el('span', {},
      el('strong', {}, 'Lista completa'),
      el('small', {}, 'Todos os inscritos, ignorando os filtros da tela (inclui as inscrições não confirmadas).'))),
    el('label', { class: 'opcao-csv opcao-cpf', for: 'csv-cpf' }, cpfChk, el('span', {},
      el('strong', {}, 'Incluir o CPF completo'),
      el('small', {}, 'Dado pessoal. Sem marcar, o CPF sai mascarado (***.456.789-**). A exportação fica registrada na auditoria.'))));
  const r = await abrirDialogo({
    titulo: 'Baixar CSV de participantes', corpo,
    botoes: [{ rotulo: 'Cancelar', valor: 'nao', classe: 'sec' }, { rotulo: 'Baixar CSV', valor: 'sim' }],
  });
  if (r !== 'sim') return;
  const completo = escTotal.checked;
  const comCpf = cpfChk.checked;
  if (comCpf) {
    const { ok } = await confirmar({ titulo: 'Exportar CPF completo', mensagem: 'O arquivo conterá CPFs completos (dado pessoal). Use apenas para finalidade legítima e proteja o arquivo. A operação será registrada na auditoria.', textoConfirmar: 'Estou ciente, baixar', perigo: true });
    if (!ok) return;
  }
  const filtrosEnviados = completo
    ? { p_busca: null, p_secretaria: null, p_orgao: null, p_municipio: null, p_inscricao: 'todas', p_checkin: 'todos', p_equipe: 'todos' }
    : filtros();
  const botao = $('baixar-csv'); botao.disabled = true;
  aviso('Gerando o arquivo…', 'info');
  const { data, error } = await sb.rpc('fn_admin_exportar_participantes', { ...filtrosEnviados, p_cpf_completo: comCpf });
  botao.disabled = false;
  if (error) return aviso(mensagemErro(error), 'erro');
  const itens = data?.itens ?? [];
  if (!itens.length) return aviso('Nenhum participante para exportar com estes filtros.', 'alerta');
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  baixarArquivo(gerarCsv(COLUNAS_CSV, itens), `participantes_${completo ? 'completo' : 'filtrado'}_${carimbo}.csv`, 'text/csv;charset=utf-8');
  aviso(`${itens.length.toLocaleString('pt-BR')} participante(s) exportado(s).${data.truncado ? ' Atenção: o limite de linhas foi atingido; refine os filtros.' : ''}`, data.truncado ? 'alerta' : 'ok');
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

async function excluir(p) {
  const { ok, motivo } = await confirmar({
    titulo: 'Excluir participante',
    mensagem: [
      `Excluir ${p.nome_completo} (${p.cpf_mascarado || 'sem CPF'}) da lista ativa?`,
      'O cadastro sairá da lista e dos indicadores do dashboard. Todos os dados ficam salvos em backup no banco (lixeira) e a operação é registrada nos logs.',
    ],
    pedirMotivo: true,
    motivoObrigatorio: true,
    textoConfirmar: 'Excluir participante',
    perigo: true,
  });
  if (!ok) return;

  const { data, error } = await sb.rpc('fn_admin_excluir_participante', {
    p_participante_id: p.id,
    p_motivo: motivo,
  });
  if (error) return aviso(mensagemErro(error), 'erro');
  if (data?.status === 'possui_checkin') return aviso(data.mensagem, 'alerta');
  if (data?.status === 'nao_encontrado') return aviso('Participante não encontrado. Atualize a página.', 'alerta');
  if (data?.status === 'dados_invalidos') return aviso(data.mensagem || 'Informe o motivo.', 'erro');
  if (data?.status !== 'sucesso') return aviso('Não foi possível excluir o participante.', 'erro');

  if (itensAtuais.length === 1 && estado.offset > 0) {
    estado.offset = Math.max(0, estado.offset - TAMANHO);
  }
  aviso(`Participante ${data.nome} excluído e arquivado na lixeira.`, 'ok');
  carregarFiltros().catch(() => {});
  carregar();
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
async function formulario({ titulo, corpo, textoConfirmar, aoConfirmar, largo = false }) {
  const msg = el('p', { class: 'msg erro', role: 'alert', hidden: true });
  for (;;) {
    const r = await abrirDialogo({
      titulo, corpo: el('div', { class: 'dlg-form' }, corpo, msg), largo,
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
  const selCat = el('select', { 'aria-label': 'Identificação' }, ...CATEGORIAS.map(([v, t]) => el('option', { value: v }, t)));
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
      el('div', { class: 'campo' }, el('label', {}, 'Identificação *'), selCat,
        el('p', { class: 'nota' }, 'Fica registrada na coluna Análise SRL/SAEB e conta como aprovado.')),
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
        p_confirmar_duplicidade: dupChk.checked, p_categoria: selCat.value,
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
  const cat = CATEGORIAS.find(([v]) => v === selCat.value)?.[1] ?? '';
  aviso(`${resultado.nome} adicionado como ${cat}${resultado.checkin ? ' e check-in registrado' + per : ''}.`, 'ok');
  carregar();
}

/* ----------------------- Editar dados do participante ----------------------- */
// Operador: nome e CPF. Administrador: todos os campos abaixo. O banco confere o perfil a cada gravação.
const CAMPOS_TEXTO = [   // [campo, rótulo, tipo do input, tamanho máximo]
  ['matricula_funcional', 'Matrícula funcional', 'text', 50],
  ['email_institucional', 'E-mail', 'email', 200],
  ['telefone_principal', 'Celular', 'tel', 50],
  ['telefone_secundario', 'Telefone secundário', 'tel', 50],
  ['secretaria', 'Secretaria', 'text', 300],
  ['orgao_unidade', 'Órgão/unidade', 'text', 300],
  ['unidade_gestora', 'Unidade gestora', 'text', 100],
  ['nome_unidade', 'Nome da unidade', 'text', 300],
  ['municipio_lotacao', 'Município de lotação', 'text', 150],
  ['cargo_funcao', 'Cargo/função', 'text', 300],
  ['area_atuacao', 'Área de atuação', 'text', 300],
  ['tipo_inscricao', 'Tipo de inscrição', 'text', 100],
  ['analise_srl_saeb', 'Análise SRL/SAEB', 'text', 1000],
];
const CAMPOS_SIMNAO = [  // [campo, rótulo, aceita "não informado"]
  ['inscricao_confirmada', 'Inscrição confirmada', false],
  ['autorizacao_contato', 'Autoriza contato', true],
  ['deseja_atualizacoes', 'Deseja receber atualizações', true],
  ['devolutiva_enviada', 'Devolutiva enviada', true],
  ['email_enviado', 'E-mail enviado', true],
];
const normaliza = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const deBool = (v) => (v === true ? 'true' : v === false ? 'false' : '');
const paraBool = (t) => (t === 'true' ? true : t === 'false' ? false : null);

async function editar(p) {
  const { data: d, error } = await sb.rpc('fn_admin_obter_participante', { p_participante_id: p.id });
  if (error) return aviso(mensagemErro(error), 'erro');
  if (d.status !== 'sucesso') return aviso('Participante não encontrado. Atualize a página.', 'erro');
  const a = d.participante;
  const completo = d.completo === true;          // administrador: recebe todos os campos

  const entradas = {};
  const campoTexto = (k, rotulo, tipo, max) => {
    const inp = el('input', { type: tipo, maxlength: max, autocomplete: 'off', 'aria-label': rotulo, value: a[k] ?? '' });
    entradas[k] = inp;
    return el('div', { class: 'campo' }, el('label', {}, rotulo), inp);
  };
  const campoSimNao = (k, rotulo, aceitaVazio) => {
    const sel = el('select', { 'aria-label': rotulo },
      aceitaVazio ? el('option', { value: '' }, 'Não informado') : null, el('option', { value: 'true' }, 'Sim'), el('option', { value: 'false' }, 'Não'));
    sel.value = deBool(a[k]);
    entradas[k] = sel;
    return el('div', { class: 'campo' }, el('label', {}, rotulo), sel);
  };

  // ---- CPF: o atual aparece só mascarado; o formulário recebe o NOVO CPF (ou deixa em branco para manter) ----
  const novoCpf = el('input', { type: 'text', inputmode: 'numeric', maxlength: 14, autocomplete: 'off', placeholder: 'Novo CPF (deixe em branco para manter)', 'aria-label': 'Novo CPF' });
  novoCpf.addEventListener('input', () => { novoCpf.value = mascararCpf(novoCpf.value); });
  const remover = completo && a.tem_cpf ? el('input', { type: 'checkbox', id: 'chk-remover-cpf', 'aria-label': 'Remover o CPF' }) : null;
  if (remover) remover.addEventListener('change', () => { novoCpf.disabled = remover.checked; if (remover.checked) novoCpf.value = ''; });
  const blocoCpf = el('div', { class: 'campo span-2 bloco-cpf' },
    el('label', {}, 'CPF'),
    el('p', { class: 'cpf-atual' }, 'CPF atual: ', a.tem_cpf ? el('strong', {}, a.cpf_mascarado) : el('span', { class: 'etiqueta ambar' }, 'sem CPF')),
    novoCpf,
    remover ? el('div', { class: 'linha-check' }, remover, el('label', { for: 'chk-remover-cpf' }, 'Remover o CPF desta pessoa (ela deixa de fazer check-in pelo CPF)')) : null,
    el('p', { class: 'nota' }, a.checkins_ativos > 0
      ? 'Esta pessoa já tem check-in: os registros anteriores continuam com o CPF da época. O novo CPF vale para os próximos.'
      : 'O CPF é validado e não pode repetir o de outra pessoa.'));

  const nome = campoTexto('nome_completo', 'Nome completo *', 'text', 200);
  const corpo = completo
    ? el('div', { class: 'grade-form' }, nome, blocoCpf,
        el('div', { class: 'secao' }, 'Contato e lotação'), ...CAMPOS_TEXTO.map((c) => campoTexto(...c)),
        el('div', { class: 'secao' }, 'Situação'), ...CAMPOS_SIMNAO.map((c) => campoSimNao(...c)))
    : el('div', {}, el('p', { class: 'nota' }, 'Você pode corrigir o nome e o CPF. Os demais dados só o administrador altera.'), nome, blocoCpf);

  let resultado = null;
  const ok = await formulario({
    titulo: `Editar — ${a.nome_completo}`, textoConfirmar: 'Salvar', largo: completo, corpo,
    aoConfirmar: async () => {
      const campos = {};
      const n = normaliza(entradas.nome_completo.value);
      if (n.length < 3) return 'Informe o nome completo.';
      if (n !== normaliza(a.nome_completo)) campos.nome_completo = n;

      if (remover && remover.checked) campos.cpf = null;
      else if (novoCpf.value.trim() !== '') {
        if (!cpfValido(novoCpf.value)) return 'CPF inválido. Confira os números.';
        campos.cpf = somenteDigitos(novoCpf.value);
      }
      if (completo) {
        for (const [k, rotulo, tipo] of CAMPOS_TEXTO) {
          const v = normaliza(entradas[k].value);
          if (v === normaliza(a[k])) continue;                 // só envia o que mudou
          if (tipo === 'email' && v && !EMAIL_RE.test(v)) return `${rotulo}: informe um e-mail válido.`;
          if (tipo === 'tel' && v && !/^[0-9+() -]{8,30}$/.test(v)) return `${rotulo}: use apenas números, espaços, parênteses, + e -.`;
          campos[k] = v;                                       // vazio = limpar o campo
        }
        for (const [k] of CAMPOS_SIMNAO) {
          const v = paraBool(entradas[k].value);
          if (v !== (a[k] ?? null)) campos[k] = v;
        }
      }
      if (!Object.keys(campos).length) { resultado = { status: 'sem_alteracoes' }; return null; }

      const { data, error: e2 } = await sb.rpc('fn_admin_editar_participante', { p_participante_id: p.id, p_campos: campos });
      if (e2) return mensagemErro(e2);
      switch (data.status) {
        case 'sucesso': case 'sem_alteracoes': resultado = data; return null;
        case 'cpf_invalido': return 'CPF inválido. Confira os números.';
        case 'cpf_existente': return `Este CPF já pertence a ${data.nome}. Não é possível usar o mesmo CPF para duas pessoas.`;
        case 'dados_invalidos': return data.mensagem || 'Dados inválidos.';
        case 'campo_nao_permitido': return 'Você não tem permissão para alterar este campo.';
        case 'nao_encontrado': return 'Participante não encontrado. Atualize a página.';
        default: return 'Não foi possível salvar as alterações.';
      }
    },
  });
  if (!ok || !resultado) return;
  if (resultado.status === 'sem_alteracoes') aviso('Nenhuma alteração foi feita.', 'info');
  else aviso(`Dados de ${resultado.nome} atualizados.`, 'ok');
  if (completo) carregarFiltros().catch(() => {});             // secretaria/órgão/município podem ter mudado
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
['f-secretaria', 'f-orgao', 'f-municipio', 'f-inscricao', 'f-checkin', 'f-equipe'].forEach((id) => $(id).addEventListener('change', recarregar));
$('anterior').addEventListener('click', () => { estado.offset = Math.max(0, estado.offset - TAMANHO); carregar(); });
$('proxima').addEventListener('click', () => { estado.offset += TAMANHO; carregar(); });
$('adicionar').addEventListener('click', adicionar);
soIcone($('anterior'), 'esq', 'Página anterior');
soIcone($('proxima'), 'dir', 'Próxima página');
comIcone($('adicionar'), 'user-plus', 'Adicionar participante');

// Só o administrador vê estes dois botões (o banco também recusa quem não for administrador).
if (ehAdmin) {
  atualizarBotaoCpf();
  $('cpf-toggle').hidden = false; $('cpf-toggle').addEventListener('click', alternarCpfs);
  comIcone($('baixar-csv'), 'baixar', 'Baixar CSV');
  $('baixar-csv').hidden = false; $('baixar-csv').addEventListener('click', baixarCsv);
}

montarCabecalho();
$('corpo').append(el('tr', {}, el('td', { colspan: COLUNAS.length, class: 'vazio' }, 'Carregando participantes…')));
// Filtros e lista saem juntos: o tempo total é o de UMA consulta, não a soma das duas.
await Promise.all([carregarFiltros().catch(() => {}), carregar()]);
