/**
 * supabase.js — criação dos clientes Supabase.
 *
 * ATENÇÃO — SEGURANÇA
 *  • Use SOMENTE a chave pública (anon / publishable). A chave service_role JAMAIS
 *    pode aparecer neste repositório: este arquivo é público no GitHub Pages.
 *  • A chave pública não substitui RLS: toda proteção real está no banco (scripts SQL).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// >>> PREENCHA com os dados do seu projeto (Supabase → Project Settings → API)
export const SUPABASE_URL = 'https://echtxguocsxyfjhnthim.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjaHR4Z3VvY3N4eWZqaG50aGltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMjc5MjMsImV4cCI6MjExMDYwMzkyM30.Ws7TdwLKjOGjrrUEhz9HqrVOGXo-mJYtOz-4yen1gqQ';

/** Interrompe a aplicação se alguém colar a chave service_role por engano. */
function verificarChave(chave) {
  if (!chave || chave.startsWith('COLE_AQUI') || SUPABASE_URL.includes('SEU-PROJETO')) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/supabase.js.');
  }
  if (chave.startsWith('sb_secret_')) {
    throw new Error('Chave secreta detectada. Use apenas a chave pública (anon/publishable).');
  }
  try {
    const partes = chave.split('.');
    if (partes.length === 3) {
      const payload = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') {
        throw new Error('Chave service_role detectada. REMOVA-A IMEDIATAMENTE e gere uma nova no Supabase.');
      }
    }
  } catch (e) {
    if (e.message && e.message.includes('service_role')) throw e;
  }
}

let _publico = null;
let _admin = null;

/** Cliente do credenciamento: sem sessão, sem persistência. */
export function clientePublico() {
  if (!_publico) {
    verificarChave(SUPABASE_ANON_KEY);
    _publico = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return _publico;
}

/** Cliente do painel: sessão guardada apenas na aba (sessionStorage) — apropriado para equipamentos compartilhados. */
export function clienteAdmin() {
  if (!_admin) {
    verificarChave(SUPABASE_ANON_KEY);
    _admin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
        storage: window.sessionStorage, storageKey: 'forum-checkin-admin',
      },
    });
  }
  return _admin;
}
