/* ===================== SETUP ===================== */
const configured =
  SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
let db = null;
if (configured) db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (v) => BRL.format(Number(v || 0));
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "—");
const daysBetween = (d) =>
  Math.floor((new Date(today()) - new Date(d)) / 86400000);

/* ===================== MENU (estrutura da Fase 1) ===================== */
const MENU = [
  {
    g: "Principal",
    items: [{ ico: "▚", label: "Dashboard", active: true }],
  },
  {
    g: "Financeiro",
    items: [
      { ico: "↘", label: "Contas a receber", soon: true },
      { ico: "↗", label: "Contas a pagar", soon: true },
      { ico: "≋", label: "Fluxo de caixa", soon: true },
    ],
  },
  {
    g: "Cadastros",
    items: [
      { ico: "◎", label: "Clientes", soon: true },
      { ico: "◍", label: "Fornecedores", soon: true },
      { ico: "⌗", label: "Categorias", soon: true },
      { ico: "⊞", label: "Centros de custo", soon: true },
      { ico: "▤", label: "Contas financeiras", soon: true },
      { ico: "▦", label: "Empresas", soon: true },
    ],
  },
  {
    g: "Gestão",
    items: [
      { ico: "◆", label: "Controladoria", soon: true },
      { ico: "◈", label: "BPO", soon: true },
    ],
  },
];
function renderMenu() {
  $("side").innerHTML = MENU.map(
    (grp) =>
      `<div class="nav-group">${grp.g}</div>` +
      grp.items
        .map(
          (it) => `
      <div class="nav-item ${it.active ? "active" : ""} ${it.soon ? "soon" : "link"}">
        <span class="ico">${it.ico}</span><span class="label">${it.label}</span>
        ${it.soon ? '<span class="tag">em breve</span>' : ""}
      </div>`,
        )
        .join(""),
  ).join("");
}

/* ===================== AUTH ===================== */
function showLoginMsg(text, type = "err") {
  $("loginMsg").innerHTML = `<div class="msg ${type}">${text}</div>`;
}

async function boot() {
  if (!configured) {
    showLoginMsg(
      "⚙️ Configuração pendente: cole a <b>Project URL</b> e a <b>anon key</b> do Supabase no topo do arquivo index.html.",
      "info",
    );
    $("loginForm").classList.add("hidden");
    return;
  }
  const {
    data: { session },
  } = await db.auth.getSession();
  if (session) enterApp(session);
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Entrando…";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("loginBtn").disabled = false;
  $("loginBtn").textContent = "Entrar";
  if (error) {
    showLoginMsg("Não foi possível entrar: e-mail ou senha inválidos.");
    return;
  }
  enterApp(data.session);
});
$("logout").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

async function enterApp(session) {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userEmail").textContent = session.user.email;
  renderMenu();
  await loadCompanies();
  await loadDashboard();
}

/* ===================== EMPRESAS ===================== */
let companyId = null; // null = todas
async function loadCompanies() {
  const { data, error } = await db
    .from("companies")
    .select("id,razao_social,nome_fantasia")
    .order("razao_social");
  const sel = $("companySel");
  if (error) {
    sel.innerHTML = "<option>Erro ao carregar</option>";
    return;
  }
  sel.innerHTML =
    '<option value="">Todas as empresas</option>' +
    (data || [])
      .map(
        (c) =>
          `<option value="${c.id}">${c.nome_fantasia || c.razao_social}</option>`,
      )
      .join("");
  sel.onchange = () => {
    companyId = sel.value || null;
    loadDashboard();
  };
}

/* ===================== DASHBOARD ===================== */
function applyScope(q) {
  return companyId ? q.eq("company_id", companyId) : q;
}

async function loadDashboard() {
  $("dashArea").innerHTML = '<div class="loading">Carregando dados…</div>';
  $("scope").textContent = companyId ? "" : "· consolidado (todas as empresas)";
  $("updated").textContent =
    "Atualizado agora · " + new Date().toLocaleString("pt-BR");

  try {
    const [acc, tx, rec, pag] = await Promise.all([
      applyScope(
        db.from("financial_accounts").select("saldo_inicial,company_id"),
      ),
      applyScope(db.from("bank_transactions").select("tipo,valor,company_id")),
      applyScope(
        db
          .from("vw_contas_receber")
          .select("saldo,situacao,vencimento,descricao,company_id"),
      ),
      applyScope(
        db
          .from("vw_contas_pagar")
          .select("saldo,situacao,vencimento,descricao,company_id"),
      ),
    ]);
    for (const r of [acc, tx, rec, pag]) if (r.error) throw r.error;

    const A = acc.data || [],
      T = tx.data || [],
      R = rec.data || [],
      P = pag.data || [];
    const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

    const saldoInicial = sum(A, (x) => x.saldo_inicial);
    const entradas = sum(
      T.filter((t) => t.tipo === "entrada"),
      (x) => x.valor,
    );
    const saidas = sum(
      T.filter((t) => t.tipo === "saida"),
      (x) => x.valor,
    );
    const saldoAtual = saldoInicial + entradas - saidas;

    const aberto = (s) => !["recebido", "pago", "cancelado"].includes(s);
    const aReceber = sum(
      R.filter((r) => aberto(r.situacao)),
      (x) => x.saldo,
    );
    const aPagar = sum(
      P.filter((p) => aberto(p.situacao)),
      (x) => x.saldo,
    );
    const vencR = sum(
      R.filter((r) => r.situacao === "vencido"),
      (x) => x.saldo,
    );
    const vencP = sum(
      P.filter((p) => p.situacao === "vencido"),
      (x) => x.saldo,
    );
    const lim = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const recebPrev = sum(
      R.filter((r) => r.situacao === "a_vencer" && r.vencimento <= lim),
      (x) => x.saldo,
    );
    const pagPrev = sum(
      P.filter((p) => p.situacao === "a_vencer" && p.vencimento <= lim),
      (x) => x.saldo,
    );

    const cards = [
      {
        lbl: "Saldo atual",
        dot: "t",
        val: money(saldoAtual),
        cls: saldoAtual < 0 ? "neg" : "",
      },
      { lbl: "Contas a receber", dot: "g", val: money(aReceber) },
      { lbl: "Contas a pagar", dot: "r", val: money(aPagar) },
      {
        lbl: "Resultado (rec − pag)",
        dot: "t",
        val: money(aReceber - aPagar),
        cls: aReceber - aPagar < 0 ? "neg" : "pos",
      },
      {
        lbl: "Recebimentos previstos (30d)",
        dot: "g",
        val: money(recebPrev),
      },
      {
        lbl: "Pagamentos previstos (30d)",
        dot: "a",
        val: money(pagPrev),
      },
      {
        lbl: "Vencido a receber",
        dot: "r",
        val: money(vencR),
        cls: vencR > 0 ? "warn" : "",
      },
      {
        lbl: "Vencido a pagar",
        dot: "r",
        val: money(vencP),
        cls: vencP > 0 ? "neg" : "",
      },
    ];

    // próximos vencimentos
    const prox = [
      ...R.filter((r) => r.situacao === "a_vencer").map((r) => ({
        tipo: "receber",
        ...r,
      })),
      ...P.filter((p) => p.situacao === "a_vencer").map((p) => ({
        tipo: "pagar",
        ...p,
      })),
    ]
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .slice(0, 8);

    // vencidas
    const venc = [
      ...R.filter((r) => r.situacao === "vencido").map((r) => ({
        tipo: "receber",
        ...r,
      })),
      ...P.filter((p) => p.situacao === "vencido").map((p) => ({
        tipo: "pagar",
        ...p,
      })),
    ]
      .sort((a, b) => daysBetween(b.vencimento) - daysBetween(a.vencimento))
      .slice(0, 8);

    $("dashArea").innerHTML = `
      <div class="cards">${cards
        .map(
          (c) => `
        <div class="kpi"><div class="lbl"><span class="dot ${c.dot}"></span>${c.lbl}</div>
          <div class="val ${c.cls || ""}">${c.val}</div></div>`,
        )
        .join("")}
      </div>
      <div class="grid2">
        <div class="panel">
          <h3><span class="dot t"></span>Próximos vencimentos</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th class="r">Valor</th></tr></thead>
          <tbody>${
            prox.length
              ? prox
                  .map(
                    (x) => `
            <tr><td>${x.descricao}</td>
              <td><span class="pill ${x.tipo}">${x.tipo === "receber" ? "A receber" : "A pagar"}</span></td>
              <td>${fmtDate(x.vencimento)}</td><td class="r">${money(x.saldo)}</td></tr>`,
                  )
                  .join("")
              : '<tr><td colspan="4"><div class="empty">Nada a vencer no momento.</div></td></tr>'
          }
          </tbody></table>
        </div>
        <div class="panel">
          <h3><span class="dot r"></span>Contas vencidas</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Atraso</th><th class="r">Valor</th></tr></thead>
          <tbody>${
            venc.length
              ? venc
                  .map(
                    (x) => `
            <tr><td>${x.descricao}</td>
              <td><span class="pill ${x.tipo}">${x.tipo === "receber" ? "A receber" : "A pagar"}</span></td>
              <td>${daysBetween(x.vencimento)} dias</td><td class="r">${money(x.saldo)}</td></tr>`,
                  )
                  .join("")
              : '<tr><td colspan="4"><div class="empty">Nenhuma conta vencida. 👏</div></td></tr>'
          }
          </tbody></table>
        </div>
      </div>`;
  } catch (err) {
    $("dashArea").innerHTML = `<div class="panel"><div class="empty">
      Não foi possível carregar os dados.<br><small>${err.message || err}</small><br><br>
      Dica: confirme que seu usuário está como <b>administrador</b> (veja o passo do SQL).
    </div></div>`;
  }
}

/* menu recolher */
$("burger").addEventListener("click", () =>
  $("app").classList.toggle("collapsed"),
);

boot();
