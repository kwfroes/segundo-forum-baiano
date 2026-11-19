/**
 * usuarios.js — gestão de logins do painel (somente administrador).
 *  • Listar / editar / ativar-desativar: funções do banco (perfil validado no servidor).
 *  • Criar login e redefinir senha: Edge Function "admin-usuarios" (a chave service_role fica só no servidor).
 *  • Dados de acesso: "Copiar mensagem" (sempre disponível) ou "Enviar por e-mail" (Edge Function "enviar-acesso": o e-mail
 *    vai SÓ para o endereço cadastrado do usuário, com os dados de acesso e instruções rápidas de uso).
 *  • Senhas são TEMPORÁRIAS: o usuário é obrigado a trocá-las no primeiro acesso.
 *  • A senha só é exibida na tela uma vez e nunca é guardada pelo sistema.
 *  • USUÁRIO PROTEGIDO: só ele mesmo altera os próprios dados (e só o nome); para os demais administradores os
 *    botões ficam desabilitados com a explicação. O banco recusa de qualquer forma (a tela é só informativa).
 *  • Botões só com ícone: title (dica ao passar o mouse) + aria-label.
 */
import { iniciarPagina, aviso, confirmar, abrirDialogo } from './admin-shell.js';
import { botaoIcone, comIcone, etiquetaIcone } from './icones.js';
import { el, limpar, formatarDataHora, formatarHoraCurta, gerarSenhaTemporaria, mensagemErro } from './utils.js';

const $ = (id) => document.getElementById(id);
const { sb, perfil } = await iniciarPagina({ requer: 'admin', pagina: 'usuarios.html' });
const { data: { session } } = await sb.auth.getSession();
const meuId = session?.user?.id;

const ROTULO_PERFIL = { administrador: 'Administrador', operador: 'Operador' };
let usuarios = [];

/* ------------------------- Chamada à Edge Function ------------------------- */
async function chamarFuncao(corpo, nome = 'admin-usuarios') {
  const { data, error } = await sb.functions.invoke(nome, { body: corpo });
  if (error) {
    let det = null;
    try { det = await error.context?.json?.(); } catch { /* sem corpo */ }
    if (det && det.mensagem) return det;
    return { ok: false, codigo: 'rede', mensagem: `Não foi possível contatar o servidor. Verifique se a função "${nome}" foi publicada e tente novamente.` };
  }
  return data || { ok: false, codigo: 'interno', mensagem: 'Resposta vazia do servidor.' };
}

/* ------------------------------ Lista ------------------------------ */
async function carregar() {
  const { data, error } = await sb.rpc('fn_admin_usuarios_listar');
  if (error) return aviso(mensagemErro(error), 'erro');
  usuarios = data;
  const corpo = $('corpo'); limpar(corpo);
  usuarios.forEach((u) => corpo.append(linha(u)));
  const ativos = usuarios.filter((u) => u.ativo).length;
  $('contagem').textContent = `${usuarios.length} usuário(s), ${ativos} ativo(s).`;
}

const MOTIVO_PROTEGIDO = 'Usuário protegido: só ele mesmo pode alterar os próprios dados.';
const MOTIVO_PROPRIO = 'Você não pode desativar o próprio acesso.';

function linha(u) {
  const eu = u.id === meuId;
  const protegido = u.protegido === true;
  const bloqueado = protegido && !eu;                         // protegido: só ele mesmo mexe
  /** Botão só com ícone. Desabilitado, vai dentro de um <span> para a dica aparecer mesmo assim. */
  const botao = (opcoes, motivo) => {
    const b = botaoIcone({ ...opcoes, desabilitado: !!opcoes.desabilitado });
    return opcoes.desabilitado ? el('span', { class: 'bloqueado', title: motivo }, b) : b;
  };
  const acoes = el('div', { class: 'acoes-tabela' },
    botao({ icone: 'editar', titulo: 'Editar nome e perfil', rotuloAria: `Editar ${u.nome}`, desabilitado: bloqueado, onclick: () => editar(u) }, MOTIVO_PROTEGIDO),
    botao({ icone: u.ativo ? 'user-x' : 'user-ok', titulo: u.ativo ? 'Desativar acesso' : 'Ativar acesso', rotuloAria: `${u.ativo ? 'Desativar' : 'Ativar'} acesso de ${u.nome}`,
      classe: u.ativo ? 'perigo' : '', desabilitado: eu || bloqueado, onclick: () => alternarAtivo(u) }, bloqueado ? MOTIVO_PROTEGIDO : MOTIVO_PROPRIO),
    botao({ icone: 'chave', titulo: 'Definir nova senha temporária', rotuloAria: `Definir nova senha temporária para ${u.nome}`, desabilitado: bloqueado, onclick: () => novaSenha(u) }, MOTIVO_PROTEGIDO),
    botao({ icone: 'email', titulo: 'Enviar link de redefinição por e-mail', rotuloAria: `Enviar link de redefinição por e-mail para ${u.nome}`, desabilitado: bloqueado, onclick: () => enviarLink(u) }, MOTIVO_PROTEGIDO),
  );
  return el('tr', {},
    el('td', { class: 'nome' }, u.nome, eu ? el('span', { class: 'etiqueta cinza' }, ' você') : null,
      protegido ? etiquetaIcone('cadeado', 'Usuário protegido: só ele mesmo pode alterar os próprios dados; remoção apenas diretamente no Supabase.', 'prot') : null),
    el('td', {}, u.email),
    el('td', {}, el('span', { class: 'etiqueta ' + (u.perfil === 'administrador' ? 'verde' : 'cinza') }, ROTULO_PERFIL[u.perfil] || u.perfil)),
    el('td', {}, el('span', { class: 'etiqueta ' + (u.ativo ? 'verde' : 'vermelha') }, u.ativo ? 'Ativo' : 'Desativado')),
    el('td', {}, u.last_sign_in_at ? formatarDataHora(u.last_sign_in_at) : 'Nunca acessou'),
    el('td', { class: 'col-acoes' }, acoes));
}

/* ------------------------ Diálogo de formulário ------------------------ */
/** Reabre o diálogo mostrando a mensagem de erro até dar certo ou o usuário cancelar. */
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

function campoSenha(valorInicial) {
  const entrada = el('input', { type: 'text', value: valorInicial, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Senha temporária', maxlength: 72 });
  const gerar = botaoIcone({ icone: 'atualizar', titulo: 'Gerar outra senha', classe: 'grande', onclick: () => { entrada.value = gerarSenhaTemporaria(); } });
  return { entrada, bloco: el('div', { class: 'campo' },
    el('label', {}, 'Senha temporária (mínimo de 8 caracteres)'),
    el('div', { class: 'senha-linha' }, entrada, gerar),
    el('p', { class: 'nota' }, 'O usuário será obrigado a trocá-la no primeiro acesso.')) };
}

/** Página de login (na mesma pasta /admin/ em que o painel está aberto). */
const linkLogin = () => new URL('index.html', location.href).href;

/** Mensagem pronta para enviar ao usuário: é o texto que o botão "Copiar mensagem" copia. */
function mensagemAcesso({ email, senha, perfil, modo }) {
  const papel = perfil === 'administrador' ? 'Administrador' : 'Operador';
  const link = linkLogin();
  const abertura = modo === 'criado'
    ? `Seu acesso ao painel de credenciamento do 2º Fórum Baiano de Compras Públicas foi criado como ${papel}.`
    : `A senha do seu acesso ao painel de credenciamento do 2º Fórum Baiano de Compras Públicas (${papel}) foi redefinida.`;
  return [abertura, '', `Link de acesso: ${link}`, `E-mail: ${email}`, `Senha temporária: ${senha}`, '', 'Ao entrar, você precisará alterar a senha.'].join('\n');
}

async function mostrarCredenciais({ titulo, email, senha, perfil, modo = 'criado', usuarioId = null, envio = null }) {
  const texto = mensagemAcesso({ email, senha, perfil, modo });
  const botoes = [{ rotulo: 'Copiar mensagem', valor: 'copiar', classe: 'sec' }];
  if (usuarioId) botoes.push({ rotulo: envio ? 'Reenviar por e-mail' : 'Enviar por e-mail', valor: 'enviar', classe: 'sec' });
  botoes.push({ rotulo: 'Concluir', valor: 'ok' });
  await abrirDialogo({
    titulo,
    corpo: el('div', { class: 'dlg-form' },
      el('p', {}, 'Mensagem pronta para enviar ao usuário por um canal seguro. ', el('strong', {}, 'A senha não será exibida novamente.')),
      usuarioId ? el('p', { class: 'nota' }, `“Enviar por e-mail” manda esta mensagem, com instruções rápidas de uso, para ${email} (o endereço cadastrado). “Copiar mensagem” continua disponível.`) : null,
      envio ? el('p', { class: 'msg ok', role: 'status' }, `E-mail enviado para ${envio.destino} às ${envio.hora}.`) : null,
      el('div', { class: 'credenciais mensagem-envio' }, texto)),
    botoes,
  }).then(async (r) => {
    if (r === 'copiar') {
      try { await navigator.clipboard.writeText(texto); aviso('Mensagem copiada. Cole e envie ao usuário.', 'ok'); } catch { aviso('Não foi possível copiar; selecione e copie o texto exibido.', 'alerta'); }
      return mostrarCredenciais({ titulo, email, senha, perfil, modo, usuarioId, envio });
    }
    if (r === 'enviar') {
      aviso('Enviando e-mail…', 'info');
      const resp = await chamarFuncao({ acao: 'enviar', usuario_id: usuarioId, senha, modo, link: linkLogin() }, 'enviar-acesso');
      let novoEnvio = envio;
      if (resp.ok) { aviso(`E-mail enviado para ${resp.destino}.`, 'ok'); novoEnvio = { destino: resp.destino, hora: formatarHoraCurta(new Date().toISOString()) }; }
      else aviso(resp.mensagem || 'Não foi possível enviar o e-mail.', 'erro');
      return mostrarCredenciais({ titulo, email, senha, perfil, modo, usuarioId, envio: novoEnvio });    // a senha continua à vista até "Concluir"
    }
    return r;
  });
}

/* ------------------------------ Ações ------------------------------ */
async function novo() {
  const nome = el('input', { type: 'text', maxlength: 200, autocomplete: 'off', 'aria-label': 'Nome' });
  const email = el('input', { type: 'email', maxlength: 200, autocomplete: 'off', 'aria-label': 'E-mail' });
  const sel = el('select', { 'aria-label': 'Perfil' },
    el('option', { value: 'operador' }, 'Operador — dashboard, consulta e check-in manual'),
    el('option', { value: 'administrador' }, 'Administrador — acesso total'));
  const senha = campoSenha(gerarSenhaTemporaria());
  let resultado = null;

  const ok = await formulario({
    titulo: 'Novo usuário', textoConfirmar: 'Criar usuário',
    corpo: [
      el('div', { class: 'campo' }, el('label', {}, 'Nome completo'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'E-mail (será o login)'), email),
      el('div', { class: 'campo' }, el('label', {}, 'Perfil'), sel),
      senha.bloco,
    ],
    aoConfirmar: async () => {
      if (!nome.value.trim()) return 'Informe o nome.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return 'Informe um e-mail válido.';
      if (senha.entrada.value.length < 8) return 'A senha temporária deve ter ao menos 8 caracteres.';
      const r = await chamarFuncao({ acao: 'criar', nome: nome.value.trim(), email: email.value.trim(), perfil: sel.value, senha: senha.entrada.value });
      if (!r.ok) return r.mensagem;
      resultado = r;
      return null;
    },
  });
  if (!ok) return;

  await carregar();
  if (resultado.existente) {
    aviso(`${email.value.trim()} já tinha login no projeto e foi autorizado no painel como ${ROTULO_PERFIL[sel.value]}. A senha dele não foi alterada.`, 'ok');
  } else {
    await mostrarCredenciais({ titulo: 'Usuário criado', email: email.value.trim().toLowerCase(), senha: senha.entrada.value, perfil: sel.value, modo: 'criado', usuarioId: resultado.usuario_id });
  }
}

async function editar(u) {
  const nome = el('input', { type: 'text', maxlength: 200, value: u.nome, 'aria-label': 'Nome' });
  const sel = el('select', { 'aria-label': 'Perfil' },
    el('option', { value: 'operador' }, 'Operador'), el('option', { value: 'administrador' }, 'Administrador'));
  sel.value = u.perfil;
  if (u.id === meuId) sel.disabled = true;
  const ok = await formulario({
    titulo: `Editar — ${u.email}`, textoConfirmar: 'Salvar',
    corpo: [
      el('div', { class: 'campo' }, el('label', {}, 'Nome completo'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'Perfil'), sel,
        u.id === meuId ? el('p', { class: 'nota' }, 'Você não pode alterar o seu próprio perfil.') : null),
    ],
    aoConfirmar: async () => {
      if (!nome.value.trim()) return 'Informe o nome.';
      const { data, error } = await sb.rpc('fn_admin_usuario_atualizar', { p_usuario: u.id, p_nome: nome.value.trim(), p_perfil: sel.value, p_ativo: u.ativo });
      if (error) return mensagemErro(error);
      if (data?.status === 'protegido') return MOTIVO_PROTEGIDO;
      return data?.status === 'sucesso' ? null : 'Usuário não encontrado.';
    },
  });
  if (ok) { aviso('Usuário atualizado.', 'ok'); carregar(); }
}

async function alternarAtivo(u) {
  const novoEstado = !u.ativo;
  const { ok } = await confirmar({
    titulo: novoEstado ? 'Ativar acesso' : 'Desativar acesso',
    mensagem: novoEstado
      ? `Reativar o acesso de ${u.nome} (${u.email})?`
      : `Desativar o acesso de ${u.nome} (${u.email})? A pessoa perde o acesso imediatamente; o histórico de ações é mantido.`,
    textoConfirmar: novoEstado ? 'Ativar' : 'Desativar', perigo: !novoEstado,
  });
  if (!ok) return;
  const { data, error } = await sb.rpc('fn_admin_usuario_atualizar', { p_usuario: u.id, p_nome: u.nome, p_perfil: u.perfil, p_ativo: novoEstado });
  if (error) return aviso(mensagemErro(error), 'erro');
  if (data?.status === 'protegido') return aviso(MOTIVO_PROTEGIDO, 'erro');
  if (data?.status !== 'sucesso') return aviso('Usuário não encontrado.', 'erro');
  aviso(novoEstado ? 'Acesso ativado.' : 'Acesso desativado.', 'ok'); carregar();
}

async function novaSenha(u) {
  const senha = campoSenha(gerarSenhaTemporaria());
  const ok = await formulario({
    titulo: `Nova senha — ${u.nome}`, textoConfirmar: 'Redefinir senha',
    corpo: [el('p', {}, `A senha atual de ${u.email} será substituída. O usuário precisará criar uma nova senha no próximo acesso.`), senha.bloco],
    aoConfirmar: async () => {
      if (senha.entrada.value.length < 8) return 'A senha temporária deve ter ao menos 8 caracteres.';
      const r = await chamarFuncao({ acao: 'redefinir_senha', usuario_id: u.id, senha: senha.entrada.value });
      return r.ok ? null : r.mensagem;
    },
  });
  if (!ok) return;
  await mostrarCredenciais({ titulo: 'Senha redefinida', email: u.email, senha: senha.entrada.value, perfil: u.perfil, modo: 'redefinida', usuarioId: u.id });
}

async function enviarLink(u) {
  const { ok } = await confirmar({ titulo: 'Enviar link de redefinição', mensagem: `Enviar para ${u.email} um e-mail com o link para a própria pessoa definir uma nova senha?`, textoConfirmar: 'Enviar link' });
  if (!ok) return;
  const destino = new URL('index.html', location.href).href;
  const { error } = await sb.auth.resetPasswordForEmail(u.email, { redirectTo: destino });
  if (error) aviso(mensagemErro(error), 'erro'); else aviso('Se o e-mail estiver correto, o link foi enviado.', 'ok');
}

comIcone($('novo'), 'user-plus', 'Novo usuário');
$('novo').addEventListener('click', novo);
await carregar();
