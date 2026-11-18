# Credenciamento — 2º Fórum Baiano de Compras Públicas (front-end)

Aplicação estática (HTML5 + CSS3 + JavaScript) para publicação no **GitHub Pages**.

1. Edite `js/supabase.js` e informe `SUPABASE_URL` e a chave **anon/publishable**.
   **Nunca** coloque a chave `service_role` neste repositório (o código recusa-se a iniciar se detectá-la).
2. Publique: Settings → Pages → branch `main`, pasta `/ (root)`; marque **Enforce HTTPS**.
3. O banco, as funções e as políticas RLS ficam no projeto Supabase (pasta `supabase/`, fora deste repositório público).

| Página | Uso |
|---|---|
| `index.html` | Credenciamento público (CPF) |
| `admin/index.html` | Login administrativo |
| `admin/dashboard.html` | Indicadores e gráfico |
| `admin/participantes.html` | Consulta, check-in manual, cancelamento, histórico |
| `admin/relatorios.html` | Exportação CSV / Excel (administrador) |
| `admin/importar.html` | Importação da base por CSV (administrador) |

Arte: `assets/logo-forum.png` e `assets/imagens/realizacao.png` foram recortadas da arte "Vem aí!". Substitua pelos arquivos oficiais em alta resolução quando disponíveis (mesmos nomes).
