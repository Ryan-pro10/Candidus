/* ===================== CORE — cliente, utilitários, estado, menu, login ===================== */
const configured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
let db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- utilitários ---------- */
const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money = v => BRL.format(Number(v||0));
const $ = id => document.getElementById(id);
const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const todayStr = () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? d.split('-').reverse().join('/') : '—';
const daysLate = d => Math.floor((new Date(todayStr()) - new Date(d)) / 86400000);
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const STLABEL = {a_vencer:'A vencer',vencido:'Vencido',recebido:'Recebido',recebido_parcial:'Receb. parcial',cancelado:'Cancelado',aberto:'Em aberto',quitado:'Quitado'};

function toast(msg,type='ok'){
  const t=el('div','toast '+type,esc(msg)); $('toast').appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

/* ---------- estado global ---------- */
let companies=[], companyId=null, currentView='dashboard';
let favSet=new Set(), userId=null;
const scopeQ = q => companyId ? q.eq('company_id',companyId) : q;
const coName = id => { const c=companies.find(x=>x.id===id); return c?(c.nome_fantasia||c.razao_social):'—'; };
function statusPill(s){ return `<span class="pill st-${s==='ativo'?'quitado':'cancelado'}">${s==='ativo'?'Ativo':'Inativo'}</span>`; }

/* ---------- menu ---------- */
const MENU = [
  {g:'Principal', items:[{ico:'▚',label:'Dashboard',view:'dashboard'}]},
  {g:'Financeiro', items:[
    {ico:'↘',label:'Contas a receber',view:'contas-receber'},
    {ico:'↗',label:'Contas a pagar',view:'contas-pagar'},
    {ico:'≋',label:'Fluxo de caixa',view:'fluxo-caixa'},
  ]},
  {g:'Cadastros', items:[
    {ico:'◎',label:'Clientes',view:'clientes'},{ico:'◍',label:'Fornecedores',view:'fornecedores'},
    {ico:'⌗',label:'Categorias',view:'categorias'},{ico:'⊞',label:'Centros de custo',view:'centros-custo'},
    {ico:'▤',label:'Contas financeiras',view:'contas-financeiras'},{ico:'▦',label:'Empresas',view:'empresas'},
  ]},
  {g:'BPO', items:[
    {ico:'◈',label:'Pendências',view:'pendencias'},
    {ico:'◇',label:'Tarefas',view:'tarefas'},
    {ico:'▦',label:'Documentos',view:'documentos'},
  ]},
  {g:'Controladoria', items:[
    {ico:'◆',label:'DRE',view:'dre'},
    {ico:'▤',label:'Orçamento',view:'orcamento'},
    {ico:'◈',label:'Realizado x Orçado',view:'realizado-orcado'},
    {ico:'◎',label:'Indicadores',view:'indicadores'},
  ]},
];
function viewMeta(v){ for(const g of MENU) for(const it of g.items) if(it.view===v) return it; return null; }
function renderMenu(){
  const side=$('side'); side.innerHTML='';
  if(favSet.size){
    side.appendChild(el('div','nav-group','Favoritos'));
    [...favSet].forEach(v=>{ const it=viewMeta(v); if(!it) return;
      const node=el('div','nav-item link'+(v===currentView?' active':''),`<span class="ico">★</span><span class="label">${it.label}</span>`);
      node.onclick=()=>setView(v); side.appendChild(node);
    });
  }
  MENU.forEach(grp=>{
    side.appendChild(el('div','nav-group',grp.g));
    grp.items.forEach(it=>{
      const cls='nav-item '+(it.soon?'soon':'link')+(it.view===currentView?' active':'');
      const star = (it.view&&!it.soon)?`<button class="star ${favSet.has(it.view)?'on':''}" title="Favoritar">${favSet.has(it.view)?'★':'☆'}</button>`:'';
      const tag = it.soon?'<span class="tag">em breve</span>':'';
      const node=el('div',cls,`<span class="ico">${it.ico}</span><span class="label">${it.label}</span>${tag}${star}`);
      if(!it.soon && it.view) node.onclick=()=>setView(it.view);
      side.appendChild(node);
      const st=node.querySelector('.star');
      if(st) st.onclick=e=>{ e.stopPropagation(); toggleFav(it.view); };
    });
  });
}
async function loadFavorites(){
  const { data }=await db.from('favorites').select('modulo');
  favSet=new Set((data||[]).map(f=>f.modulo));
}
async function toggleFav(v){
  if(favSet.has(v)){
    const { error }=await db.from('favorites').delete().eq('user_id',userId).eq('modulo',v);
    if(error){ toast('Erro ao desfavoritar.','err'); return; }
    favSet.delete(v);
  }else{
    const { error }=await db.from('favorites').insert({user_id:userId,modulo:v});
    if(error){ toast('Erro ao favoritar.','err'); return; }
    favSet.add(v);
  }
  renderMenu();
}

/* ---------- roteador de telas ---------- */
function setView(v){ currentView=v; renderMenu(); if(v==='dashboard')renderDashboard(); else if(v==='contas-receber')renderContasReceber(); else if(v==='contas-pagar')renderContasPagar(); else if(v==='categorias')renderCategorias(); else if(v==='fluxo-caixa')renderFluxo(); else if(v==='pendencias')renderPendencias(); else if(v==='tarefas')renderTarefas(); else if(v==='documentos')renderDocumentos(); else if(v==='dre')renderDre(); else if(v==='orcamento')renderOrcamento(); else if(v==='realizado-orcado')renderRxO(); else if(v==='indicadores')renderIndicadores(); else if(v==='empresas')renderEmpresas(); else if(['clientes','fornecedores','centros-custo','contas-financeiras'].includes(v))renderCadastro(v); }

/* ---------- login / sessão ---------- */
function showLoginMsg(t,type='err'){ $('loginMsg').innerHTML=`<div class="msg ${type}">${t}</div>`; }
async function boot(){
  if(!configured){ showLoginMsg('⚙️ Configuração pendente: cole a <b>anon key</b> do Supabase em <b>js/config.js</b>.','info'); $('loginForm').classList.add('hidden'); return; }
  const { data:{ session } } = await db.auth.getSession();
  if(session) enterApp(session);
}
$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('loginBtn').disabled=true; $('loginBtn').textContent='Entrando…';
  const { data, error } = await db.auth.signInWithPassword({ email:$('email').value.trim(), password:$('password').value });
  $('loginBtn').disabled=false; $('loginBtn').textContent='Entrar';
  if(error){ showLoginMsg('Não foi possível entrar: e-mail ou senha inválidos.'); return; }
  enterApp(data.session);
});
$('logout').addEventListener('click', async ()=>{ await db.auth.signOut(); location.reload(); });
$('burger').addEventListener('click', ()=> $('app').classList.toggle('collapsed'));

async function enterApp(session){
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  $('userEmail').textContent=session.user.email;
  userId=session.user.id;
  await loadCompanies();
  await loadFavorites();
  setView('dashboard');
}
async function loadCompanies(){
  const { data } = await db.from('companies').select('id,razao_social,nome_fantasia').order('razao_social');
  companies = data||[];
  const sel=$('companySel');
  sel.innerHTML='<option value="">Todas as empresas</option>'+companies.map(c=>`<option value="${c.id}">${esc(c.nome_fantasia||c.razao_social)}</option>`).join('');
  sel.onchange=()=>{ companyId=sel.value||null; setView(currentView); };
}

/* ---------- modais genéricos ---------- */
function closeModal(){ $('modalRoot').innerHTML=''; }

/* Modal de confirmação com a identidade do Candidus (substitui o confirm() do navegador) */
function confirmModal({titulo, texto, ok='Confirmar', perigo=false}){
  return new Promise(resolve=>{
    $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
      <div class="modal-h"><h2>${esc(titulo)}</h2><button class="x" id="cfX">×</button></div>
      <div class="modal-b"><p style="font-size:14px;color:var(--text);line-height:1.5">${esc(texto)}</p></div>
      <div class="modal-f"><button class="btn ghost" id="cfNo">Cancelar</button>
        <button class="btn ${perigo?'danger':''}" id="cfYes">${esc(ok)}</button></div>
    </div></div>`;
    const done=v=>{ closeModal(); resolve(v); };
    $('cfX').onclick=$('cfNo').onclick=()=>done(false);
    $('cfYes').onclick=()=>done(true);
  });
}