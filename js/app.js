/* ===================== APP — menu, favoritos, roteamento das telas, tema, login e inicialização (carregar por último) ===================== */
const MENU = [
  {g:'Principal', items:[{ico:'▚',label:'Dashboard',view:'dashboard'}]},
  {g:'Financeiro', items:[
    {ico:'↘',label:'Contas a receber',view:'contas-receber'},
    {ico:'↗',label:'Contas a pagar',view:'contas-pagar'},
    {ico:'≋',label:'Fluxo de caixa',view:'fluxo-caixa'},
    {ico:'▭',label:'Cartões',view:'cartoes'},
    {ico:'↧',label:'Importar extrato',view:'importar'},
    {ico:'⇄',label:'Conciliação',view:'conciliacao'},
    {ico:'✓',label:'Baixa em lote',view:'baixa-lote'},
    {ico:'↻',label:'Recorrentes',view:'recorrentes'},
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
    {ico:'⊞',label:'Custos e centros de custo',view:'custos'},
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
function setView(v){ currentView=v; renderMenu(); if(v==='dashboard')renderDashboard(); else if(v==='contas-receber')renderContasReceber(); else if(v==='contas-pagar')renderContasPagar(); else if(v==='categorias')renderCategorias(); else if(v==='fluxo-caixa')renderFluxo(); else if(v==='cartoes')renderCartoes(); else if(v==='importar')renderImportar(); else if(v==='conciliacao')renderConciliacao(); else if(v==='baixa-lote')renderBaixaLote(); else if(v==='recorrentes')renderRecorrentes(); else if(v==='pendencias')renderPendencias(); else if(v==='tarefas')renderTarefas(); else if(v==='documentos')renderDocumentos(); else if(v==='dre')renderDre(); else if(v==='custos')renderCustos(); else if(v==='orcamento')renderOrcamento(); else if(v==='realizado-orcado')renderRxO(); else if(v==='indicadores')renderIndicadores(); else if(v==='empresas')renderEmpresas(); else if(['clientes','fornecedores','centros-custo','contas-financeiras'].includes(v))renderCadastro(v); }

function showLoginMsg(t,type='err'){ $('loginMsg').innerHTML=`<div class="msg ${type}">${t}</div>`; }
function applyTheme(t){ document.body.classList.toggle('dark', t==='dark'); const b=$('themeToggle'); if(b) b.textContent = t==='dark'?'☀️':'🌙'; }
function toggleTheme(){ const nt=document.body.classList.contains('dark')?'light':'dark'; try{localStorage.setItem('candidus_theme',nt);}catch(e){} applyTheme(nt);
  const b=$('themeToggle'); if(b){ b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); } }
try{ applyTheme(localStorage.getItem('candidus_theme')||'light'); }catch(e){ applyTheme('light'); }
$('themeToggle').addEventListener('click', toggleTheme);

async function boot(){
  if(!configured){ showLoginMsg('⚙️ Configuração pendente: cole a <b>anon key</b> do Supabase em js/config.js.','info'); $('loginForm').classList.add('hidden'); return; }
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
  try{ await db.rpc('gerar_recorrencias',{}); }catch(e){}  // gera contas recorrentes vencidas ao entrar
  setView('dashboard');
}
async function loadCompanies(){
  const { data } = await db.from('companies').select('id,razao_social,nome_fantasia').order('razao_social');
  companies = data||[];
  const sel=$('companySel');
  sel.innerHTML='<option value="">Todas as empresas</option>'+companies.map(c=>`<option value="${c.id}">${esc(c.nome_fantasia||c.razao_social)}</option>`).join('');
  sel.onchange=()=>{ companyId=sel.value||null; setView(currentView); };
}

boot();
