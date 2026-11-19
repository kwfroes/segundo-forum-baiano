/**
 * checkin.js — credenciamento público (RF001–RF005), com suporte ao CHECK-IN DUPLO.
 * Toda a regra de negócio roda no banco (função fn_checkin_publico); aqui há apenas
 * validação de entrada, chamada da função e apresentação do resultado.
 * O CPF digitado não é gravado em nenhum armazenamento do navegador.
 */
import { clientePublico } from './supabase.js';
import { mascararCpf, cpfValido, somenteDigitos, formatarData, formatarHora } from './utils.js';

const $ = (id) => document.getElementById(id);
const telaInicial = $('tela-inicial'), telaResultado = $('tela-resultado');
const form = $('form-checkin'), campo = $('cpf'), erro = $('erro-cpf'), botao = $('btn-checkin');

let config = {
  evento_nome: '2º Fórum Baiano de Compras Públicas', checkin_aberto: true, tempo_retorno_segundos: 8,
  checkin_duplo: false, periodo_atual: 'unico', manha_ate: '12:00', tarde_de: '13:30',
};
let temporizador = null;
let enviando = false;
let bloqueado = false;          // intervalo do check-in duplo

/** "12:00" → "12h"; "13:30" → "13h30" */
const horaTexto = (t) => {
  const [h, m] = String(t || '').split(':');
  if (h === undefined || m === undefined) return String(t || '');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
};
const NOME_PERIODO = { manha: 'da manhã', tarde: 'da tarde' };

/* ---------------------------- Ícones (SVG) ---------------------------- */
const ICONES = {
  sucesso: ['#218653', 'M28 50 l14 14 l28 -30'],
  alerta:  ['#D99A21', 'M48 26 v26 M48 66 v.5'],
  erro:    ['#B3131B', 'M32 32 l32 32 M64 32 l-32 32'],
};
function desenharIcone(tipo) {
  const [cor, caminho] = ICONES[tipo];
  const svg = $('icone-resultado');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', 48); c.setAttribute('cy', 48); c.setAttribute('r', 44); c.setAttribute('fill', cor); c.setAttribute('opacity', '.14');
  const c2 = document.createElementNS(ns, 'circle');
  c2.setAttribute('cx', 48); c2.setAttribute('cy', 48); c2.setAttribute('r', 44); c2.setAttribute('fill', 'none'); c2.setAttribute('stroke', cor); c2.setAttribute('stroke-width', 4);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', caminho); p.setAttribute('fill', 'none'); p.setAttribute('stroke', cor);
  p.setAttribute('stroke-width', 8); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(c, c2, p);
}

/* ------------------------- Mensagens (documento) ------------------------- */
function mensagem(chave, dados = {}) {
  const per = NOME_PERIODO[dados.periodo];            // só existe no check-in duplo
  switch (chave) {
    case 'sucesso':
      return { tipo: 'sucesso', titulo: 'Check-in realizado com sucesso!',
        texto: per ? `Seu check-in ${per} foi registrado. Seja bem-vindo!`
                   : 'Sua presença no 2º Fórum Baiano de Compras Públicas foi confirmada. Seja bem-vindo!' };
    case 'ja_realizado':
      return { tipo: 'alerta', titulo: per ? `Check-in ${per} já realizado` : 'Check-in já realizado',
        texto: per ? `Seu check-in ${per} já foi realizado anteriormente. Caso precise de auxílio, procure a equipe de credenciamento.`
                   : 'Seu check-in já foi realizado anteriormente. Caso precise de auxílio, procure a equipe de credenciamento.' };
    case 'intervalo':
      return { tipo: 'alerta', titulo: 'Check-in indisponível no intervalo',
        texto: `O check-in da tarde começa às ${horaTexto(dados.tarde_de || config.tarde_de)}.` };
    case 'nao_encontrado':
      return { tipo: 'erro', titulo: 'CPF não localizado', texto: 'Não encontramos uma inscrição vinculada ao CPF informado. Verifique os números digitados ou procure a equipe de credenciamento.' };
    case 'nao_confirmado':
      return { tipo: 'alerta', titulo: 'Inscrição não confirmada', texto: 'Sua inscrição ainda não está confirmada. Procure a equipe de organização para verificar sua situação.' };
    case 'encerrado':
      return { tipo: 'alerta', titulo: 'Credenciamento indisponível', texto: 'O credenciamento não está disponível no momento. Procure a equipe de organização.' };
    case 'limite_excedido':
      return { tipo: 'alerta', titulo: 'Muitas tentativas', texto: 'Foram registradas muitas tentativas em pouco tempo. Aguarde alguns instantes ou procure a equipe de credenciamento.' };
    default:
      return { tipo: 'erro', titulo: 'Não foi possível concluir', texto: 'Houve um problema de comunicação. Verifique a conexão e tente novamente ou procure a equipe de credenciamento.' };
  }
}

/* ------------------------------ Telas ------------------------------ */
function mostrarErroCampo(msg) {
  erro.textContent = msg || '';
  campo.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function aplicarBloqueio() {
  botao.disabled = enviando || bloqueado;
  campo.disabled = bloqueado;
}

/** Faixa informativa do período (check-in duplo) e bloqueio durante o intervalo. */
function atualizarFaixa() {
  const faixa = $('info-periodo');
  const p = config.checkin_duplo ? config.periodo_atual : 'unico';
  faixa.className = 'aviso-periodo';
  if (p === 'manha') {
    faixa.textContent = `Check-in da manhã — válido até ${horaTexto(config.manha_ate)}`;
    faixa.hidden = false;
  } else if (p === 'tarde') {
    faixa.textContent = 'Check-in da tarde';
    faixa.hidden = false;
  } else if (p === 'intervalo') {
    faixa.textContent = `Intervalo — o check-in da tarde abre às ${horaTexto(config.tarde_de)}.`;
    faixa.classList.add('intervalo');
    faixa.hidden = false;
  } else {
    faixa.hidden = true;
  }
  bloqueado = p === 'intervalo' && config.checkin_aberto !== false;
  aplicarBloqueio();
}

function irParaInicio() {
  clearInterval(temporizador);
  telaResultado.hidden = true;
  telaInicial.hidden = false;
  campo.value = '';
  mostrarErroCampo('');
  enviando = false;
  carregarConfig().then(() => { if (!campo.disabled) campo.focus(); });
  aplicarBloqueio();
  if (!campo.disabled) campo.focus();
}

function mostrarResultado(chave, dados = {}) {
  const m = mensagem(chave, dados);
  telaResultado.className = 'cartao resultado ' + m.tipo;
  desenharIcone(m.tipo);
  $('res-titulo').textContent = m.titulo;
  $('res-mensagem').textContent = m.texto;
  const nome = $('res-nome');
  nome.hidden = !dados.nome; nome.textContent = dados.nome || '';
  const quando = $('res-quando');
  if (dados.data_hora) {
    quando.hidden = false;
    quando.textContent = `Credenciado em ${formatarData(dados.data_hora)} às ${formatarHora(dados.data_hora)}`;
  } else quando.hidden = true;
  $('res-evento').textContent = dados.evento || config.evento_nome;

  telaInicial.hidden = true;
  telaResultado.hidden = false;

  // Retorno automático (RF005) — tempo configurável no banco
  const total = Math.max(3, Number(config.tempo_retorno_segundos) || 8);
  let restante = total;
  const barra = $('res-barra');
  $('res-contagem').textContent = restante;
  barra.style.transition = 'none'; barra.style.transform = 'scaleX(1)';
  void barra.offsetWidth;
  barra.style.transition = `transform ${total}s linear`; barra.style.transform = 'scaleX(0)';
  clearInterval(temporizador);
  temporizador = setInterval(() => {
    restante -= 1;
    $('res-contagem').textContent = Math.max(restante, 0);
    if (restante <= 0) irParaInicio();
  }, 1000);
  $('btn-voltar').focus();
}

/* ---------------------------- Configuração ---------------------------- */
async function carregarConfig() {
  try {
    const { data, error } = await clientePublico().rpc('fn_config_publica');
    if (!error && data) config = { ...config, ...data };
  } catch { /* mantém o último valor conhecido */ }
  $('aviso-fechado').hidden = config.checkin_aberto !== false;
  atualizarFaixa();
}

/* ------------------------------ Eventos ------------------------------ */
campo.addEventListener('input', () => {
  campo.value = mascararCpf(campo.value);   // somente números + máscara (RF002)
  if (erro.textContent) mostrarErroCampo('');
});
campo.addEventListener('keydown', (e) => {
  if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (enviando || bloqueado) return;
  const digitos = somenteDigitos(campo.value);
  if (!digitos) return mostrarErroCampo('Informe o seu CPF.');
  if (digitos.length !== 11) return mostrarErroCampo('O CPF deve ter 11 dígitos.');
  if (!cpfValido(digitos)) return mostrarErroCampo('CPF inválido. Confira os números digitados.');

  enviando = true; aplicarBloqueio();
  const rotulo = botao.textContent;
  botao.textContent = ''; botao.append(Object.assign(document.createElement('span'), { className: 'girando' }), ' Verificando…');
  try {
    const { data, error } = await clientePublico().rpc('fn_checkin_publico', { p_cpf: digitos });
    campo.value = '';                          // não mantém o CPF em tela
    if (error || !data) mostrarResultado('falha');
    else if (data.status === 'cpf_invalido') { mostrarErroCampo('CPF inválido. Confira os números digitados.'); }
    else {
      if (data.status === 'intervalo') carregarConfig();      // a faixa passa a refletir o intervalo
      mostrarResultado(data.status, data);
    }
  } catch {
    mostrarResultado('falha');
  } finally {
    botao.textContent = rotulo; enviando = false; aplicarBloqueio();
    if (!telaInicial.hidden && !campo.disabled) campo.focus();
  }
});

$('btn-voltar').addEventListener('click', irParaInicio);

carregarConfig();
// O período muda com o horário: atualiza a faixa e o bloqueio mesmo com a tela parada.
setInterval(() => { if (!telaInicial.hidden) carregarConfig(); }, 30000);
