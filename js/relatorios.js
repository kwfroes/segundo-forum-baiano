/**
 * relatorios.js — RF010: exportação em CSV e Excel (somente administrador).
 * O CPF é mascarado por padrão; o CPF completo exige confirmação e fica na auditoria.
 */
import { iniciarPagina, aviso, confirmar } from './admin-shell.js';
import { el, limpar, gerarCsv, baixarArquivo, formatarDataHora, seguroPlanilha, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb } = await iniciarPagina({ requer: 'admin', pagina: 'relatorios.html' });

const sim = (b) => (b ? 'Sim' : 'Não');
const COLUNAS = [
  { titulo: 'Nome completo', valor: (r) => r.nome_completo },
  { titulo: 'CPF', valor: (r) => r.cpf ?? '' },
  { titulo: 'Matrícula funcional', valor: (r) => r.matricula_funcional ?? '' },
  { titulo: 'Órgão/unidade', valor: (r) => r.orgao_unidade ?? '' },
  { titulo: 'Secretaria', valor: (r) => r.secretaria ?? '' },
  { titulo: 'Unidade gestora', valor: (r) => r.unidade_gestora ?? '' },
  { titulo: 'Nome da unidade', valor: (r) => r.nome_unidade ?? '' },
  { titulo: 'Município de lotação', valor: (r) => r.municipio_lotacao ?? '' },
  { titulo: 'Cargo/função', valor: (r) => r.cargo_funcao ?? '' },
  { titulo: 'Área de atuação', valor: (r) => r.area_atuacao ?? '' },
  { titulo: 'Inscrição confirmada', valor: (r) => sim(r.inscricao_confirmada) },
  { titulo: 'Presente', valor: (r) => sim(r.presente) },
  { titulo: 'Data/hora do check-in', valor: (r) => formatarDataHora(r.checkin_data_hora) },
  { titulo: 'Origem do check-in', valor: (r) => (r.checkin_metodo === 'publico' ? 'Credenciamento público' : r.checkin_metodo === 'administrativo' ? 'Administrativo' : '') },
];

const TITULOS = {
  todos: 'Todos os inscritos', confirmados: 'Inscrições confirmadas', presentes: 'Participantes presentes',
  ausentes: 'Participantes ausentes', secretaria: 'Participantes por secretaria', orgao: 'Participantes por órgão/unidade',
};

let linhas = []; let tipoGerado = 'todos';

const { data: f } = await sb.rpc('fn_admin_filtros');
(f?.secretarias || []).forEach((v) => $('r-secretaria').append(el('option', { value: v }, v)));
(f?.orgaos || []).forEach((v) => $('r-orgao').append(el('option', { value: v }, v)));

$('r-tipo').addEventListener('change', () => {
  $('bloco-secretaria').hidden = $('r-tipo').value !== 'secretaria';
  $('bloco-orgao').hidden = $('r-tipo').value !== 'orgao';
});

$('r-gerar').addEventListener('click', async () => {
  const tipo = $('r-tipo').value;
  const cpfCompleto = $('r-cpf').checked;
  if (cpfCompleto) {
    const { ok } = await confirmar({ titulo: 'Exportar CPF completo', mensagem: 'O arquivo conterá CPFs completos (dado pessoal). Use apenas para finalidade legítima e proteja o arquivo. A operação será registrada na auditoria.', textoConfirmar: 'Estou ciente, gerar', perigo: true });
    if (!ok) return;
  }
  const btn = $('r-gerar'); btn.disabled = true;
  const { data, error } = await sb.rpc('fn_admin_exportar', {
    p_tipo: tipo,
    p_secretaria: tipo === 'secretaria' ? $('r-secretaria').value : null,
    p_orgao: tipo === 'orgao' ? $('r-orgao').value : null,
    p_cpf_completo: cpfCompleto,
  });
  btn.disabled = false;
  if (error) return aviso(mensagemErro(error), 'erro');

  linhas = data; tipoGerado = tipo;
  $('r-resultado').hidden = false;
  $('r-titulo').textContent = TITULOS[tipo];
  $('r-info').textContent = `${linhas.length} registro(s). Pré-visualização das primeiras 20 linhas.`;
  const cab = $('r-cab'); limpar(cab); cab.append(el('tr', {}, COLUNAS.map((c) => el('th', {}, c.titulo))));
  const corpo = $('r-corpo'); limpar(corpo);
  linhas.slice(0, 20).forEach((r) => corpo.append(el('tr', {}, COLUNAS.map((c) => el('td', {}, c.valor(r))))));
  $('r-csv').disabled = $('r-xlsx').disabled = linhas.length === 0;
});

const nomeArquivo = (ext) => {
  const d = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `forum-credenciamento_${tipoGerado}_${d}.${ext}`;
};

$('r-csv').addEventListener('click', () => {
  baixarArquivo(gerarCsv(COLUNAS, linhas), nomeArquivo('csv'), 'text/csv;charset=utf-8');
});

$('r-xlsx').addEventListener('click', async () => {
  const btn = $('r-xlsx'); btn.disabled = true;
  try {
    // Biblioteca carregada sob demanda a partir do CDN oficial do SheetJS
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const aoa = [COLUNAS.map((c) => c.titulo), ...linhas.map((r) => COLUNAS.map((c) => seguroPlanilha(c.valor(r))))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COLUNAS.map((c, i) => ({ wch: i === 0 ? 40 : 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Participantes');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    baixarArquivo(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo('xlsx'));
  } catch {
    aviso('Não foi possível gerar o Excel. Use o CSV (abre no Excel) ou verifique a conexão.', 'erro');
  } finally { btn.disabled = false; }
});
