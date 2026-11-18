/**
 * importar.js — Seção 7: importação da base de inscritos por CSV (somente administrador).
 * Tratamento no navegador (normalização, validação, duplicidades) + revalidação no banco.
 * A atualização NÃO altera check-ins (tabela separada, não tocada pela importação).
 */
import { iniciarPagina, aviso, confirmar } from './admin-shell.js';
import { el, limpar, interpretarCsv, somenteDigitos, cpfValido, gerarCsv, baixarArquivo, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb } = await iniciarPagina({ requer: 'admin', pagina: 'importar.html' });

const TAMANHO_LOTE = 500;
const TEXTOS = ['matricula_funcional', 'telefone_principal', 'telefone_secundario', 'email_institucional', 'orgao_unidade', 'secretaria', 'unidade_gestora', 'nome_unidade', 'municipio_lotacao', 'cargo_funcao', 'area_atuacao', 'analise_srl_saeb'];
const BOOLEANOS = ['autorizacao_contato', 'deseja_atualizacoes', 'inscricao_confirmada', 'devolutiva_enviada', 'email_enviado'];
const CAMPOS = ['nome_completo', 'cpf', ...TEXTOS, ...BOOLEANOS];

// Nomes alternativos de cabeçalho (já normalizados: minúsculas, sem acento, "_" no lugar de separadores)
const ALIASES = {
  nome_completo: ['nome', 'nome_completo', 'nome_do_participante', 'participante'],
  cpf: ['cpf', 'cpf_do_participante', 'n_do_cpf'],
  matricula_funcional: ['matricula', 'matricula_funcional'],
  telefone_principal: ['telefone_principal', 'telefone', 'celular', 'celular_principal', 'whatsapp'],
  telefone_secundario: ['telefone_secundario', 'telefone_alternativo', 'telefone_2'],
  email_institucional: ['email_institucional', 'email', 'e_mail', 'email_informado', 'e_mail_institucional'],
  orgao_unidade: ['orgao_unidade', 'orgao', 'orgao_ou_unidade', 'unidade_vinculada', 'orgao_unidade_vinculada'],
  secretaria: ['secretaria'],
  unidade_gestora: ['unidade_gestora', 'ug', 'codigo_ug', 'codigo_da_ug'],
  nome_unidade: ['nome_unidade', 'nome_da_unidade'],
  municipio_lotacao: ['municipio_lotacao', 'municipio', 'municipio_de_lotacao', 'cidade'],
  cargo_funcao: ['cargo_funcao', 'cargo', 'funcao', 'cargo_ou_funcao'],
  area_atuacao: ['area_atuacao', 'area_de_atuacao', 'area'],
  autorizacao_contato: ['autorizacao_contato', 'autoriza_contato', 'autorizacao_para_contato'],
  deseja_atualizacoes: ['deseja_atualizacoes', 'deseja_receber_atualizacoes', 'interesse_em_atualizacoes'],
  inscricao_confirmada: ['inscricao_confirmada', 'confirmada', 'confirmado', 'confirmacao', 'situacao_da_inscricao', 'situacao'],
  devolutiva_enviada: ['devolutiva_enviada', 'devolutiva'],
  analise_srl_saeb: ['analise_srl_saeb', 'analise_srl', 'analise'],
  email_enviado: ['email_enviado', 'e_mail_enviado'],
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const mapaAlias = new Map();
for (const [campo, lista] of Object.entries(ALIASES)) lista.forEach((a) => mapaAlias.set(a, campo));

function paraBooleano(v) {
  const t = norm(v);
  if (!t) return null;
  if (/^(nao|n|false|0|no|falso|pendente|nao_confirmad[oa]|aguardando)(_|$)/.test(t)) return false;
  if (/^(sim|s|true|1|x|yes|y|verdadeiro|confirmad[oa]|ok|autorizo|aprovad[oa])(_|$)/.test(t)) return true;
  return undefined;   // não reconhecido
}

let validos = [];        // registros prontos para envio
let ocorrencias = [];    // erros e avisos da conferência
let colunasPresentes = [];
let nomeArquivo = '';

function ocorrencia(linha, tipo, nome, mensagem) { ocorrencias.push({ linha, tipo, nome: nome || '', mensagem }); }

function processar(texto) {
  validos = []; ocorrencias = [];
  const tabela = interpretarCsv(texto);
  if (tabela.length < 2) throw new Error('O arquivo não possui dados.');

  const cabecalho = tabela[0].map(norm);
  const indice = {}; const ignoradas = [];
  cabecalho.forEach((h, i) => {
    const campo = mapaAlias.get(h);
    if (campo && !(campo in indice)) indice[campo] = i; else if (h) ignoradas.push(tabela[0][i]);
  });
  if (!('nome_completo' in indice)) throw new Error('Coluna de nome não encontrada. Use o modelo de CSV.');
  colunasPresentes = CAMPOS.filter((c) => c in indice);

  const cpfsVistos = new Map();
  tabela.slice(1).forEach((cols, n) => {
    const linha = n + 2;
    const v = (c) => (c in indice ? String(cols[indice[c]] ?? '').trim() : '');
    const nome = v('nome_completo');
    if (!nome) return ocorrencia(linha, 'erro', '', 'Registro incompleto: nome ausente.');

    const reg = { _linha: linha, nome_completo: nome };
    // CPF
    let d = somenteDigitos(v('cpf'));
    if (d) {
      if (d.length >= 9 && d.length < 11) { d = d.padStart(11, '0'); ocorrencia(linha, 'aviso', nome, 'CPF com menos de 11 dígitos: zeros à esquerda restaurados.'); }
      if (!cpfValido(d)) return ocorrencia(linha, 'erro', nome, 'CPF inválido.');
      if (cpfsVistos.has(d)) return ocorrencia(linha, 'erro', nome, `CPF duplicado no arquivo (já informado na linha ${cpfsVistos.get(d)}).`);
      cpfsVistos.set(d, linha);
      reg.cpf = d;
    } else {
      reg.cpf = '';
      ocorrencia(linha, 'aviso', nome, 'Registro sem CPF: não poderá usar o check-in automático.');
    }
    TEXTOS.forEach((c) => { if (c in indice) reg[c] = v(c); });
    BOOLEANOS.forEach((c) => {
      if (!(c in indice)) return;
      const b = paraBooleano(v(c));
      if (b === undefined) { ocorrencia(linha, 'aviso', nome, `Valor não reconhecido em "${c}": "${v(c)}" (tratado como vazio).`); reg[c] = null; } else reg[c] = b;
    });
    validos.push(reg);
  });

  return { total: tabela.length - 1, ignoradas };
}

function cartao(rotulo, valor, classe = '') { return el('div', { class: 'indicador ' + classe }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor)); }

function mostrarPrevia(info) {
  const erros = ocorrencias.filter((o) => o.tipo === 'erro').length;
  const avisos = ocorrencias.filter((o) => o.tipo === 'aviso').length;
  $('previa').hidden = false; $('relatorio').hidden = true;
  const r = $('resumo-previa'); limpar(r);
  r.append(cartao('Linhas lidas', info.total), cartao('Prontas para importar', validos.length, 'ok'), cartao('Com erro (não serão importadas)', erros, erros ? 'destaque' : ''), cartao('Avisos', avisos, avisos ? 'alerta' : ''));
  $('colunas-info').textContent = `Colunas reconhecidas: ${colunasPresentes.join(', ')}.` + (info.ignoradas.length ? ` Ignoradas: ${info.ignoradas.join(', ')}.` : '');
  const cab = $('p-cab'); limpar(cab); cab.append(el('tr', {}, ['Linha', 'nome_completo', 'cpf', 'secretaria', 'orgao_unidade', 'inscricao_confirmada'].map((t) => el('th', {}, t))));
  const corpo = $('p-corpo'); limpar(corpo);
  validos.slice(0, 5).forEach((x) => corpo.append(el('tr', {},
    el('td', {}, x._linha), el('td', {}, x.nome_completo), el('td', {}, x.cpf ? `***.${x.cpf.slice(3, 6)}.${x.cpf.slice(6, 9)}-**` : '—'),
    el('td', {}, x.secretaria ?? ''), el('td', {}, x.orgao_unidade ?? ''), el('td', {}, x.inscricao_confirmada === undefined ? '' : String(x.inscricao_confirmada)))));
  $('importar').disabled = validos.length === 0;
}

$('arquivo').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  if (!arq) return;
  if (arq.size > 20 * 1024 * 1024) return aviso('Arquivo maior que 20 MB.', 'erro');
  nomeArquivo = arq.name;
  try {
    mostrarPrevia(processar(await arq.text()));
  } catch (err) {
    $('previa').hidden = true;
    aviso(err.message, 'erro');
  }
});

$('importar').addEventListener('click', async () => {
  const { ok } = await confirmar({ titulo: 'Importar base', mensagem: `Serão processados ${validos.length} registro(s). Registros existentes (mesmo CPF) serão atualizados; check-ins já realizados não são alterados.`, textoConfirmar: 'Importar' });
  if (!ok) return;

  $('importar').disabled = true; $('arquivo').disabled = true;
  const barra = $('progresso'); barra.hidden = false; barra.value = 0;
  const total = { inseridos: 0, atualizados: 0 };
  const servidor = [];
  try {
    for (let i = 0; i < validos.length; i += TAMANHO_LOTE) {
      const lote = validos.slice(i, i + TAMANHO_LOTE);
      const { data, error } = await sb.rpc('fn_admin_importar_participantes', { p_registros: lote, p_colunas: colunasPresentes, p_nome_arquivo: nomeArquivo });
      if (error) throw error;
      total.inseridos += data.inseridos; total.atualizados += data.atualizados;
      (data.erros || []).forEach((x) => servidor.push({ linha: Number(x.linha) || x.linha, tipo: 'erro', nome: x.nome || '', mensagem: x.mensagem }));
      barra.value = Math.round(((i + lote.length) / validos.length) * 100);
    }
    aviso('Importação concluída.', 'ok');
  } catch (err) {
    aviso('Importação interrompida: ' + mensagemErro(err) + ' Lotes já processados foram gravados; reenviar o mesmo arquivo é seguro.', 'erro');
  } finally {
    $('arquivo').disabled = false; barra.hidden = true;
  }
  ocorrencias = [...ocorrencias, ...servidor].sort((a, b) => Number(a.linha) - Number(b.linha));
  mostrarRelatorio(total);
});

function mostrarRelatorio(total) {
  $('relatorio').hidden = false;
  const erros = ocorrencias.filter((o) => o.tipo === 'erro').length;
  const r = $('resumo-final'); limpar(r);
  r.append(cartao('Inseridos', total.inseridos, 'ok'), cartao('Atualizados', total.atualizados), cartao('Erros', erros, erros ? 'destaque' : ''), cartao('Avisos', ocorrencias.length - erros, 'alerta'));
  const corpo = $('r-ocorrencias'); limpar(corpo);
  if (!ocorrencias.length) corpo.append(el('tr', {}, el('td', { colspan: 4, class: 'vazio' }, 'Nenhuma ocorrência.')));
  ocorrencias.forEach((o) => corpo.append(el('tr', {}, el('td', {}, o.linha), el('td', {}, el('span', { class: 'etiqueta ' + (o.tipo === 'erro' ? 'vermelha' : 'ambar') }, o.tipo === 'erro' ? 'Erro' : 'Aviso')), el('td', {}, o.nome), el('td', {}, o.mensagem))));
  $('relatorio').scrollIntoView({ behavior: 'smooth' });
}

$('baixar-erros').addEventListener('click', () => {
  const cols = [{ titulo: 'Linha', valor: (o) => o.linha }, { titulo: 'Tipo', valor: (o) => o.tipo }, { titulo: 'Participante', valor: (o) => o.nome }, { titulo: 'Mensagem', valor: (o) => o.mensagem }];
  baixarArquivo(gerarCsv(cols, ocorrencias), 'relatorio-importacao.csv', 'text/csv;charset=utf-8');
});

$('modelo').addEventListener('click', () => {
  const cab = CAMPOS.join(';');
  const exemplo = 'Maria da Silva;12345678909;123456;71999990000;;maria@ba.gov.br;Superintendência X;SAEB;000001;Nome da Unidade;Salvador;Analista;Compras;;sim;sim;sim;não;não';
  baixarArquivo('\uFEFF' + cab + '\r\n' + exemplo + '\r\n', 'modelo-importacao-inscritos.csv', 'text/csv;charset=utf-8');
});
