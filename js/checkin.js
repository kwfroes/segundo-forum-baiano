/**
 * checkin.js — credenciamento público (RF001–RF005).
 * Toda a regra de negócio roda no banco (função fn_checkin_publico); aqui há apenas
 * validação de entrada, chamada da função e apresentação do resultado.
 * O CPF digitado não é gravado em nenhum armazenamento do navegador.
 */
import { clientePublico } from './supabase.js';
import { mascararCpf, cpfValido, somenteDigitos, formatarData, formatarHora } from './utils.js';

const $ = (id) => document.getElementById(id);
const telaInicial = $('tela-inicial'), telaResultado = $('tela-resultado');
const form = $('form-checkin'), campo = $('cpf'), erro = $('erro-cpf'), botao = $('btn-checkin');

let config = { evento_nome: '2º Fórum Baiano de Compras Públicas', checkin_aberto: true, tempo_retorno_segundos: 8 };
let temporizador = null;
let enviando = false;

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
const MENSAGENS = {
  sucesso:        { tipo: 'sucesso', titulo: 'Check-in realizado com sucesso!', texto: 'Sua presença no 2º Fórum Baiano de Compras Públicas foi confirmada. Seja bem-vindo!' },
  nao_encontrado: { tipo: 'erro',    titulo: 'CPF não localizado', texto: 'Não encontramos uma inscrição vinculada ao CPF informado. Verifique os números digitados ou procure a equipe de credenciamento.' },
  nao_confirmado: { tipo: 'alerta',  titulo: 'Inscrição não confirmada', texto: 'Sua inscrição ainda não está confirmada. Procure a equipe de organização para verificar sua situação.' },
  ja_realizado:   { tipo: 'alerta',  titulo: 'Check-in já realizado', texto: 'Seu check-in já foi realizado anteriormente. Caso precise de auxílio, procure a equipe de credenciamento.' },
  encerrado:      { tipo: 'alerta',  titulo: 'Credenciamento indisponível', texto: 'O credenciamento não está disponível no momento. Procure a equipe de organização.' },
  limite_excedido:{ tipo: 'alerta',  titulo: 'Muitas tentativas', texto: 'Foram registradas muitas tentativas em pouco tempo. Aguarde alguns instantes ou procure a equipe de credenciamento.' },
  falha:          { tipo: 'erro',    titulo: 'Não foi possível concluir', texto: 'Houve um problema de comunicação. Verifique a conexão e tente novamente ou procure a equipe de credenciamento.' },
};

/* ------------------------------ Telas ------------------------------ */
function mostrarErroCampo(msg) {
  erro.textContent = msg || '';
  campo.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function irParaInicio() {
  clearInterval(temporizador);
  telaResultado.hidden = true;
  telaInicial.hidden = false;
  campo.value = '';
  mostrarErroCampo('');
  enviando = false;
  botao.disabled = false;
  carregarConfig();
  campo.focus();
}

function mostrarResultado(chave, dados = {}) {
  const m = MENSAGENS[chave] || MENSAGENS.falha;
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
  } catch { /* mantém padrão */ }
  $('aviso-fechado').hidden = config.checkin_aberto !== false;
}

/* ------------------------------ Eventos ------------------------------ */
campo.addEventListener('input', () => {
  campo.value = mascararCpf(campo.value);   // somente números + máscara (RF002)
  if (erro.textContent) mostrarErroCampo('');
});
campo.addEventListener('keydown', (e) => {
  // bloqueia caracteres não numéricos (mantém teclas de controle e atalhos)
  if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (enviando) return;
  const digitos = somenteDigitos(campo.value);
  if (!digitos) return mostrarErroCampo('Informe o seu CPF.');
  if (digitos.length !== 11) return mostrarErroCampo('O CPF deve ter 11 dígitos.');
  if (!cpfValido(digitos)) return mostrarErroCampo('CPF inválido. Confira os números digitados.');

  enviando = true; botao.disabled = true;
  const rotulo = botao.textContent;
  botao.textContent = ''; botao.append(Object.assign(document.createElement('span'), { className: 'girando' }), ' Verificando…');
  try {
    const { data, error } = await clientePublico().rpc('fn_checkin_publico', { p_cpf: digitos });
    campo.value = '';                          // não mantém o CPF em tela
    if (error || !data) mostrarResultado('falha');
    else if (data.status === 'cpf_invalido') { mostrarErroCampo('CPF inválido. Confira os números digitados.'); }
    else mostrarResultado(data.status, data);
  } catch {
    mostrarResultado('falha');
  } finally {
    botao.textContent = rotulo; botao.disabled = false; enviando = false;
    if (!telaInicial.hidden) campo.focus();
  }
});

$('btn-voltar').addEventListener('click', irParaInicio);

carregarConfig();
