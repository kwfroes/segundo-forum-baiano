/**
 * importar.js — Seção 7: importação da base de inscritos (somente administrador).
 *
 * O sistema ESPERA o arquivo no molde da planilha "Dados 2 forum.csv" (CSV com separador ";",
 * UTF-8 ou ANSI, cabeçalho na 1ª linha, 21 colunas). Os cabeçalhos são reconhecidos pelo início
 * do texto (ex.: "Nome completo (sem apelidos ou abreviações)"), sem diferenciar acentos/maiúsculas.
 *
 * Tratamentos (antes de gravar no banco):
 *  • CPF: remove pontuação; restaura zeros à esquerda; valida dígitos verificadores.
 *    CPF inválido ou repetido (outra pessoa) → a pessoa entra SEM CPF (atendimento manual).
 *  • Inscrição duplicada (mesmo CPF e mesma pessoa; ou mesmo nome + e-mail) → ignorada e reportada.
 *  • "Inscrição confirmada": o administrador escolhe o critério na prévia — coluna "Análise SRL/SAEB"
 *    (SIM, PAINELISTA, PRODUÇÃO e PALESTRANTE = confirmada) ou coluna "Inscrição confirmada" (SIM).
 *  • "Sim, autorizo" / "Não desejo." / "SIM" / "Não se aplica" → booleanos.
 *  • Linhas em branco e colunas extras vazias são ignoradas; nome ausente → erro.
 *  • Check-ins existentes nunca são alterados (tabela separada).
 */
import { iniciarPagina, aviso, confirmar } from './admin-shell.js';
import { el, limpar, interpretarCsv, decodificarArquivo, somenteDigitos, cpfValido, cpfOculto, gerarCsv, baixarArquivo, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb } = await iniciarPagina({ requer: 'admin', pagina: 'importar.html' });

const TAMANHO_LOTE = 500;
const MAX_OCORRENCIAS_TELA = 300;

/* ------------------------------- Molde ------------------------------- */
// Ordem e títulos idênticos aos do arquivo "Dados 2 forum.csv".
const MOLDE = [
  { campo: 'tipo_inscricao',      titulo: 'Tipo de inscrição',                                  re: /^tipo_de_inscricao/ },
  { campo: 'data_inscricao',      titulo: 'Data de inscrição',                                  re: /^data_de_inscricao/ },
  { campo: 'nome_completo',       titulo: 'Nome completo (sem apelidos ou abreviações)',        re: /^nome_completo|^nome$/, obrigatoria: true },
  { campo: 'cpf',                 titulo: 'CPF (somente números)',                              re: /^cpf/, obrigatoria: true },
  { campo: 'matricula_funcional', titulo: 'Matrícula funcional (somente números)',              re: /^matricula/ },
  { campo: 'telefone_principal',  titulo: 'Contato telefônico principal (Celular)',             re: /^contato_telefonico_principal|^telefone_principal/ },
  { campo: 'telefone_secundario', titulo: 'Contato telefônico secundário (Telefone)',           re: /^contato_telefonico_secundario|^telefone_secundario/ },
  { campo: 'email_institucional', titulo: 'E-mail institucional (a confirmação da inscrição será enviada para o e-mail informado neste campo)', re: /^e_mail_institucional|^email_institucional|^e_?mail$/ },
  { campo: 'orgao_unidade',       titulo: 'Órgão/unidade vinculada',                            re: /^orgao_unidade/ },
  { campo: 'secretaria',          titulo: 'Secretaria',                                         re: /^secretaria$/ },
  { campo: 'unidade_gestora',     titulo: 'Unidade Gestora',                                    re: /^unidade_gestora/ },
  { campo: 'nome_unidade',        titulo: 'Nome da Unidade',                                    re: /^nome_da_unidade|^nome_unidade/ },
  { campo: 'municipio_lotacao',   titulo: 'Município de lotação',                               re: /^municipio/ },
  { campo: 'cargo_funcao',        titulo: 'Cargo/função',                                       re: /^cargo_funcao|^cargo$/ },
  { campo: 'area_atuacao',        titulo: 'Área de atuação',                                    re: /^area_de_atuacao|^area_atuacao/ },
  { campo: 'autorizacao_contato', titulo: 'Autorizo a organização do 2º Fórum de Compras Públicas do Estado da Bahia a entrar em contato comigo, por meio dos telefones e do e-mail informados nesta inscrição, caso seja necessário para a realização do evento.', re: /^autorizo/, bool: true },
  { campo: 'deseja_atualizacoes', titulo: 'Deseja receber atualizações sobre o Projeto Sistema Integrado de Logística por e-mail?', re: /^deseja_receber/, bool: true },
  { campo: 'inscricao_confirmada', titulo: 'Inscrição confirmada',                              re: /^inscricao_confirmada/, bool: true },
  { campo: 'devolutiva_enviada',  titulo: 'Devolutiva enviada',                                 re: /^devolutiva/, bool: true },
  { campo: 'analise_srl_saeb',    titulo: 'Análise SRL/SAEB',                                   re: /^analise/ },
  { campo: 'email_enviado',       titulo: 'E-mail enviado',                                     re: /^e_mail_enviado|^email_enviado/, bool: true },
];
const TEXTOS = ['tipo_inscricao', 'matricula_funcional', 'telefone_principal', 'telefone_secundario', 'email_institucional', 'orgao_unidade', 'secretaria', 'unidade_gestora', 'nome_unidade', 'municipio_lotacao', 'cargo_funcao', 'area_atuacao'];
const BOOLEANOS = ['autorizacao_contato', 'deseja_atualizacoes', 'devolutiva_enviada', 'email_enviado'];
const ANALISE_APROVADA = new Set(['sim', 'painelista', 'producao', 'palestrante']);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const limparEspacos = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const chaveNome = (s) => norm(s);

/** SIM/NÃO do molde → { valor, desconhecido }. "Não se aplica" e vazio → valor null. */
function lerBooleano(v) {
  const t = norm(v);
  if (!t || t === 'nao_se_aplica' || t === 'n_a') return { valor: null };
  if (/^(sim|s|true|1|x|yes|y|verdadeiro|confirmad[oa])(_|$)/.test(t)) return { valor: true };
  if (/^(nao|n|false|0|no|falso)(_|$)/.test(t)) return { valor: false };
  return { valor: null, desconhecido: true };
}

/** "2026-11-11 23:52:34" ou "11/11/2026 23:52" → ISO com fuso de Salvador (-03:00). */
function lerData(v) {
  const s = String(v ?? '').trim();
  if (!s) return { valor: null };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { valor: `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00` };
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { valor: `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00` };
  return { valor: null, invalida: true };
}

/* ----------------------------- Estado ----------------------------- */
let estado = null;   // { aceitos, ocorrencias, colunas, lidas, ignoradas, faltantes, criterio, nomeArquivo }

function ocorrencia(lista, linha, tipo, nome, mensagem) { lista.push({ linha, tipo, nome: nome || '', mensagem }); }

/* --------------------------- Processamento --------------------------- */
function processar(texto) {
  const tabela = interpretarCsv(texto);
  if (tabela.length < 2) throw new Error('O arquivo não possui dados (é necessário o cabeçalho e ao menos uma linha).');

  // 1) Cabeçalho × molde
  const indice = {}; const ignoradas = [];
  tabela[0].forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const item = MOLDE.find((m) => !(m.campo in indice) && m.re.test(n));
    if (item) indice[item.campo] = i; else ignoradas.push(limparEspacos(h).slice(0, 60));
  });
  const reconhecidas = MOLDE.filter((m) => m.campo in indice);
  const faltantes = MOLDE.filter((m) => !(m.campo in indice));
  const obrigatoriasFaltando = faltantes.filter((m) => m.obrigatoria);
  if (obrigatoriasFaltando.length || reconhecidas.length < 6) {
    const falta = (obrigatoriasFaltando.length ? obrigatoriasFaltando : faltantes).map((m) => m.titulo.split(' (')[0]);
    throw new Error('Arquivo fora do molde esperado ("Dados 2 forum.csv"). Colunas não encontradas: ' + falta.join('; ') + '. Use "Baixar modelo de CSV" para ver o formato.');
  }
  const col = (cols, campo) => (campo in indice ? String(cols[indice[campo]] ?? '').trim() : '');

  const ocorrencias = [];
  const candidatos = [];

  // 2) Leitura linha a linha
  tabela.slice(1).forEach((cols) => {
    const linha = cols.numero;
    const nome = limparEspacos(col(cols, 'nome_completo'));
    if (!nome) return ocorrencia(ocorrencias, linha, 'erro', '', 'Não importado: nome completo ausente.');

    const reg = { _linha: linha, nome_completo: nome, cpf: '' };
    const meta = { semCpfMotivo: null, avisos: [] };

    // CPF
    let d = somenteDigitos(col(cols, 'cpf'));
    if (d) {
      if (d.length >= 9 && d.length < 11) { d = d.padStart(11, '0'); meta.avisos.push('CPF com menos de 11 dígitos: zeros à esquerda restaurados.'); }
      if (cpfValido(d)) reg.cpf = d;
      else meta.semCpfMotivo = `CPF inválido (${d.length === 11 ? cpfOculto(d) : 'tamanho incorreto'}): importado sem CPF — atendimento manual no credenciamento. Corrija no arquivo e reimporte para liberar o check-in por CPF.`;
    }

    TEXTOS.forEach((c) => { if (c in indice) reg[c] = limparEspacos(col(cols, c)); });
    if ('email_institucional' in indice) reg.email_institucional = reg.email_institucional.toLowerCase();
    BOOLEANOS.forEach((c) => {
      if (!(c in indice)) return;
      const r = lerBooleano(col(cols, c));
      if (r.desconhecido) meta.avisos.push(`Valor não reconhecido em "${MOLDE.find((m) => m.campo === c).titulo.split(' (')[0].slice(0, 40)}": "${col(cols, c).slice(0, 30)}" (tratado como vazio).`);
      reg[c] = r.valor;
    });
    if ('analise_srl_saeb' in indice) {
      const a = limparEspacos(col(cols, 'analise_srl_saeb')).toLocaleUpperCase('pt-BR');
      reg.analise_srl_saeb = a;
    }
    if ('data_inscricao' in indice) {
      const dt = lerData(col(cols, 'data_inscricao'));
      if (dt.invalida) meta.avisos.push(`Data de inscrição não reconhecida: "${col(cols, 'data_inscricao').slice(0, 25)}" (ignorada).`);
      reg.data_inscricao = dt.valor;
    }

    // critérios possíveis para "inscrição confirmada"
    meta.confColuna = 'inscricao_confirmada' in indice ? lerBooleano(col(cols, 'inscricao_confirmada')).valor === true : null;
    meta.confAnalise = 'analise_srl_saeb' in indice ? ANALISE_APROVADA.has(norm(reg.analise_srl_saeb)) : null;

    if (nome.split(' ').length < 2) meta.avisos.push('Nome possivelmente incompleto (sem sobrenome) — confira.');
    candidatos.push({ reg, meta });
  });

  // 3) Duplicidades — CPF repetido
  const porCpf = new Map();
  const aceitos = [];
  candidatos.forEach((c) => {
    const { reg, meta } = c;
    if (reg.cpf) {
      const anterior = porCpf.get(reg.cpf);
      if (!anterior) { porCpf.set(reg.cpf, c); return aceitos.push(c); }
      const mesmaPessoa = (reg.matricula_funcional && reg.matricula_funcional === anterior.reg.matricula_funcional)
        || (reg.email_institucional && reg.email_institucional === anterior.reg.email_institucional)
        || chaveNome(reg.nome_completo) === chaveNome(anterior.reg.nome_completo);
      if (mesmaPessoa) {
        return ocorrencia(ocorrencias, reg._linha, 'erro', reg.nome_completo, `Não importado: inscrição duplicada (mesmo CPF e mesma pessoa que a linha ${anterior.reg._linha}, "${anterior.reg.nome_completo}").`);
      }
      meta.semCpfMotivo = `CPF igual ao da linha ${anterior.reg._linha} ("${anterior.reg.nome_completo}"), mas é outra pessoa: importado sem CPF — confira qual CPF está correto e reimporte.`;
      reg.cpf = '';
    }
    aceitos.push(c);
  });

  // 4) Duplicidades — sem CPF: mesmo nome + e-mail de outro registro
  const chaveNE = (r) => `${chaveNome(r.nome_completo)}|${(r.email_institucional || '').toLowerCase()}`;
  const comCpf = new Map();
  aceitos.forEach((c) => { if (c.reg.cpf) comCpf.set(chaveNE(c.reg), c); });
  const vistosSemCpf = new Map();
  const finais = [];
  aceitos.forEach((c) => {
    if (c.reg.cpf) return finais.push(c);
    const k = chaveNE(c.reg);
    const outro = comCpf.get(k) || vistosSemCpf.get(k);
    if (outro) {
      return ocorrencia(ocorrencias, c.reg._linha, 'erro', c.reg.nome_completo, `Não importado: inscrição duplicada (mesmo nome e e-mail da linha ${outro.reg._linha}).`);
    }
    vistosSemCpf.set(k, c);
    finais.push(c);
  });

  // 5) Avisos dos registros aceitos
  finais.forEach(({ reg, meta }) => {
    if (!reg.cpf) {
      ocorrencia(ocorrencias, reg._linha, 'aviso', reg.nome_completo, meta.semCpfMotivo || 'Registro sem CPF: não poderá usar o check-in automático (atendimento manual).');
    }
    meta.avisos.forEach((m) => ocorrencia(ocorrencias, reg._linha, 'aviso', reg.nome_completo, m));
  });
  ocorrencias.sort((a, b) => a.linha - b.linha);

  const nColuna = finais.filter((c) => c.meta.confColuna === true).length;
  const nAnalise = finais.filter((c) => c.meta.confAnalise === true).length;
  const temColuna = 'inscricao_confirmada' in indice, temAnalise = 'analise_srl_saeb' in indice;
  let criterio = 'nenhum';
  if (temColuna && (nColuna > 0 || !temAnalise)) criterio = 'coluna';
  else if (temAnalise) criterio = 'analise';

  return {
    aceitos: finais, ocorrencias, colunas: reconhecidas.map((m) => m.campo),
    lidas: tabela.length - 1, ignoradas, faltantes: faltantes.map((m) => m.titulo.split(' (')[0]),
    temColuna, temAnalise, nColuna, nAnalise, criterio,
  };
}

/* ------------------------------ Interface ------------------------------ */
const cartao = (rotulo, valor, classe = '') => el('div', { class: 'indicador ' + classe }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor));
const fmt = (n) => n.toLocaleString('pt-BR');
const confirmadaPorCriterio = (c, criterio) => (criterio === 'coluna' ? c.meta.confColuna === true : criterio === 'analise' ? c.meta.confAnalise === true : false);

function desenharOcorrencias(corpo, lista) {
  limpar(corpo);
  if (!lista.length) { corpo.append(el('tr', {}, el('td', { colspan: 4, class: 'vazio' }, 'Nenhuma ocorrência.'))); return; }
  lista.slice(0, MAX_OCORRENCIAS_TELA).forEach((o) => corpo.append(el('tr', {},
    el('td', {}, o.linha),
    el('td', {}, el('span', { class: 'etiqueta ' + (o.tipo === 'erro' ? 'vermelha' : 'ambar') }, o.tipo === 'erro' ? 'Não importado' : 'Aviso')),
    el('td', {}, o.nome), el('td', {}, o.mensagem))));
  if (lista.length > MAX_OCORRENCIAS_TELA) corpo.append(el('tr', {}, el('td', { colspan: 4, class: 'vazio' }, `… e mais ${lista.length - MAX_OCORRENCIAS_TELA} ocorrência(s). Baixe o CSV para ver todas.`)));
}

function atualizarPrevia() {
  const e = estado;
  const erros = e.ocorrencias.filter((o) => o.tipo === 'erro').length;
  const avisos = e.ocorrencias.length - erros;
  const semCpf = e.aceitos.filter((c) => !c.reg.cpf).length;
  const conf = e.aceitos.filter((c) => confirmadaPorCriterio(c, e.criterio)).length;

  const r = $('resumo-previa'); limpar(r);
  r.append(
    cartao('Linhas lidas', fmt(e.lidas)),
    cartao('Serão importadas', fmt(e.aceitos.length), 'ok'),
    cartao('Inscrição confirmada', e.criterio === 'nenhum' ? '—' : fmt(conf), 'ok'),
    cartao('Sem CPF (atend. manual)', fmt(semCpf), semCpf ? 'alerta' : ''),
    cartao('Não importadas', fmt(erros), erros ? 'destaque' : ''),
    cartao('Avisos', fmt(avisos), avisos ? 'alerta' : ''),
  );

  $('n-coluna').textContent = e.temColuna ? `${fmt(e.nColuna)} registro(s) marcados como SIM` : 'coluna ausente no arquivo';
  $('n-analise').textContent = e.temAnalise ? `${fmt(e.nAnalise)} registro(s) aprovados (SIM, PAINELISTA, PRODUÇÃO, PALESTRANTE)` : 'coluna ausente no arquivo';
  $('crit-coluna').disabled = !e.temColuna;
  $('crit-analise').disabled = !e.temAnalise;
  $('crit-coluna').checked = e.criterio === 'coluna';
  $('crit-analise').checked = e.criterio === 'analise';
  $('bloco-criterio').hidden = !(e.temColuna || e.temAnalise);

  const m = $('msg-criterio');
  if (e.temColuna && e.temAnalise && e.nColuna === 0 && e.nAnalise > 0) {
    m.hidden = false;
    m.textContent = `Atenção: na coluna "Inscrição confirmada" nenhum registro está como SIM. Por isso foi pré-selecionada a "Análise SRL/SAEB". Se escolher "Inscrição confirmada", ninguém conseguirá fazer check-in até que a confirmação seja feita no painel.`;
  } else m.hidden = true;

  const info = [`Colunas reconhecidas: ${e.colunas.length} de ${MOLDE.length}.`];
  if (e.faltantes.length) info.push(`Ausentes: ${e.faltantes.join('; ')}.`);
  if (e.ignoradas.length) info.push(`Ignoradas: ${e.ignoradas.join('; ')}.`);
  $('colunas-info').textContent = info.join(' ');

  const cab = $('p-cab'); limpar(cab);
  cab.append(el('tr', {}, ['Linha', 'Nome', 'CPF', 'Secretaria', 'Órgão/unidade', 'Análise', 'Confirmada'].map((t) => el('th', {}, t))));
  const corpo = $('p-corpo'); limpar(corpo);
  e.aceitos.slice(0, 5).forEach(({ reg, meta }) => corpo.append(el('tr', {},
    el('td', {}, reg._linha), el('td', {}, reg.nome_completo), el('td', {}, reg.cpf ? cpfOculto(reg.cpf) : '—'),
    el('td', {}, reg.secretaria ?? ''), el('td', {}, reg.orgao_unidade ?? ''), el('td', {}, reg.analise_srl_saeb ?? ''),
    el('td', {}, confirmadaPorCriterio({ reg, meta }, e.criterio) ? 'Sim' : 'Não'))));

  desenharOcorrencias($('p-ocorrencias'), e.ocorrencias);
  $('n-ocorrencias').textContent = `${e.ocorrencias.length} ocorrência(s)`;
  $('importar').disabled = e.aceitos.length === 0;
}

function paraEnvio(c, criterio) {
  const { reg } = c;
  const o = { ...reg };
  if (criterio !== 'nenhum') o.inscricao_confirmada = confirmadaPorCriterio(c, criterio);
  return o;
}

/* ------------------------------- Eventos ------------------------------- */
$('arquivo').addEventListener('change', async (ev) => {
  const arq = ev.target.files[0];
  if (!arq) return;
  if (arq.size > 20 * 1024 * 1024) return aviso('Arquivo maior que 20 MB.', 'erro');
  $('relatorio').hidden = true;
  try {
    const texto = decodificarArquivo(await arq.arrayBuffer());
    estado = { ...processar(texto), nomeArquivo: arq.name };
    $('previa').hidden = false;
    atualizarPrevia();
  } catch (err) {
    estado = null;
    $('previa').hidden = true;
    aviso(err.message, 'erro');
  }
});

['crit-coluna', 'crit-analise'].forEach((id) => $(id).addEventListener('change', () => {
  if (!estado) return;
  estado.criterio = $('crit-analise').checked ? 'analise' : 'coluna';
  atualizarPrevia();
}));

$('importar').addEventListener('click', async () => {
  if (!estado) return;
  const e = estado;
  const conf = e.aceitos.filter((c) => confirmadaPorCriterio(c, e.criterio)).length;
  const semCpf = e.aceitos.filter((c) => !c.reg.cpf).length;
  const linhasMsg = [
    `Serão processados ${fmt(e.aceitos.length)} registro(s); ${fmt(semCpf)} sem CPF (atendimento manual).`,
    e.criterio === 'nenhum'
      ? 'O arquivo não traz coluna de confirmação: novos registros entram como NÃO confirmados.'
      : `Inscrição confirmada (critério: ${e.criterio === 'analise' ? 'Análise SRL/SAEB' : 'coluna Inscrição confirmada'}): ${fmt(conf)} confirmada(s) e ${fmt(e.aceitos.length - conf)} não confirmada(s).`,
    'Registros já existentes serão atualizados (mesmo CPF, ou mesmo nome + e-mail). Check-ins já realizados não são alterados.',
  ];
  const { ok } = await confirmar({ titulo: 'Importar base', mensagem: linhasMsg, textoConfirmar: 'Importar' });
  if (!ok) return;

  $('importar').disabled = true; $('arquivo').disabled = true;
  const barra = $('progresso'); barra.hidden = false; barra.value = 0;
  const colunas = e.criterio === 'nenhum' ? e.colunas.filter((c) => c !== 'inscricao_confirmada') : [...new Set([...e.colunas, 'inscricao_confirmada'])];
  const total = { inseridos: 0, atualizados: 0 };
  const servidor = [];
  try {
    for (let i = 0; i < e.aceitos.length; i += TAMANHO_LOTE) {
      const lote = e.aceitos.slice(i, i + TAMANHO_LOTE).map((c) => paraEnvio(c, e.criterio));
      const { data, error } = await sb.rpc('fn_admin_importar_participantes', { p_registros: lote, p_colunas: colunas, p_nome_arquivo: e.nomeArquivo });
      if (error) throw error;
      total.inseridos += data.inseridos; total.atualizados += data.atualizados;
      (data.erros || []).forEach((x) => servidor.push({ linha: Number(x.linha) || x.linha, tipo: 'erro', nome: x.nome || '', mensagem: x.mensagem }));
      barra.value = Math.round(((i + lote.length) / e.aceitos.length) * 100);
    }
    aviso('Importação concluída.', 'ok');
  } catch (err) {
    aviso('Importação interrompida: ' + mensagemErro(err) + ' Lotes já processados foram gravados; reenviar o mesmo arquivo é seguro.', 'erro');
  } finally {
    $('arquivo').disabled = false; barra.hidden = true; $('importar').disabled = false;
  }
  e.finais = [...e.ocorrencias, ...servidor].sort((a, b) => Number(a.linha) - Number(b.linha));
  mostrarRelatorio(total, e.finais);
});

function mostrarRelatorio(total, lista) {
  $('relatorio').hidden = false;
  const erros = lista.filter((o) => o.tipo === 'erro').length;
  const r = $('resumo-final'); limpar(r);
  r.append(cartao('Inseridos', fmt(total.inseridos), 'ok'), cartao('Atualizados', fmt(total.atualizados)), cartao('Não importadas', fmt(erros), erros ? 'destaque' : ''), cartao('Avisos', fmt(lista.length - erros), 'alerta'));
  desenharOcorrencias($('r-ocorrencias'), lista);
  $('relatorio').scrollIntoView({ behavior: 'smooth' });
}

const COLUNAS_RELATORIO = [
  { titulo: 'Linha no arquivo', valor: (o) => o.linha },
  { titulo: 'Situação', valor: (o) => (o.tipo === 'erro' ? 'Não importado' : 'Aviso') },
  { titulo: 'Participante', valor: (o) => o.nome },
  { titulo: 'Mensagem', valor: (o) => o.mensagem },
];
const baixarOcorrencias = (lista) => baixarArquivo(gerarCsv(COLUNAS_RELATORIO, lista), 'relatorio-importacao.csv', 'text/csv;charset=utf-8');
$('baixar-erros').addEventListener('click', () => baixarOcorrencias(estado?.finais || estado?.ocorrencias || []));
$('baixar-ocorrencias').addEventListener('click', () => baixarOcorrencias(estado?.ocorrencias || []));

/** Modelo no molde: mesmos 21 títulos do arquivo "Dados 2 forum.csv" + 1 linha de exemplo. */
$('modelo').addEventListener('click', () => {
  const exemplo = ['SurveyMonkey', '2026-11-11 09:00:00', 'MARIA DA SILVA SOUZA', '123.456.789-09', '123456', '+55 71 99999 0000', '+55 71 3115 0000', 'maria.souza@saeb.ba.gov.br', 'SAEB - 09.021 - SUPERINTENDENCIA DE RECURSOS LOGISTICOS', 'SAEB', '09.021', 'SUPERINTENDENCIA DE RECURSOS LOGISTICOS', 'Salvador', 'COORDENADORA', 'Compras', 'Sim, autorizo', 'Sim, desejo.', 'Não', 'Não', 'SIM', 'SIM'];
  const esc = (v) => (/[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  baixarArquivo('\uFEFF' + MOLDE.map((m) => esc(m.titulo)).join(';') + '\r\n' + exemplo.map(esc).join(';') + '\r\n', 'modelo-importacao-inscritos.csv', 'text/csv;charset=utf-8');
});

// Lista do molde na tela
const lista = $('lista-molde');
MOLDE.forEach((m) => lista.append(el('li', {}, m.titulo.length > 70 ? m.titulo.slice(0, 67) + '…' : m.titulo, m.obrigatoria ? el('strong', {}, ' (obrigatória)') : null)));
