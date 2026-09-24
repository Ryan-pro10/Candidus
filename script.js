const configured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
let db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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

let companies=[], companyId=null, currentView='dashboard';
let favSet=new Set(), userId=null;
const scopeQ = q => companyId ? q.eq('company_id',companyId) : q;

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
    {ico:'▤',label:'Contas financeiras',view:'contas-financeiras'},{ico:'▦',label:'Empresas',soon:true},
  ]},
  {g:'BPO', items:[
    {ico:'◈',label:'Pendências',view:'pendencias'},
    {ico:'◇',label:'Tarefas',view:'tarefas'},
    {ico:'▦',label:'Documentos',view:'documentos'},
  ]},
  {g:'Controladoria', items:[
    {ico:'◆',label:'DRE',view:'dre'},
    {ico:'▤',label:'Orçamento',soon:true},
    {ico:'◈',label:'Realizado x Orçado',soon:true},
    {ico:'◎',label:'Indicadores',soon:true},
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
function setView(v){ currentView=v; renderMenu(); if(v==='dashboard')renderDashboard(); else if(v==='contas-receber')renderContasReceber(); else if(v==='contas-pagar')renderContasPagar(); else if(v==='categorias')renderCategorias(); else if(v==='fluxo-caixa')renderFluxo(); else if(v==='pendencias')renderPendencias(); else if(v==='tarefas')renderTarefas(); else if(v==='documentos')renderDocumentos(); else if(v==='dre')renderDre(); else if(['clientes','fornecedores','centros-custo','contas-financeiras'].includes(v))renderCadastro(v); }

function showLoginMsg(t,type='err'){ $('loginMsg').innerHTML=`<div class="msg ${type}">${t}</div>`; }
async function boot(){
  if(!configured){ showLoginMsg('⚙️ Configuração pendente: cole a <b>anon key</b> do Supabase no topo do index.html.','info'); $('loginForm').classList.add('hidden'); return; }
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

async function renderDashboard(){
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Dashboard</h1><span class="scope">${companyId?'':'· consolidado (todas as empresas)'}</span></div>
    <div class="updated">Atualizado agora · ${new Date().toLocaleString('pt-BR')}</div>
    <div id="dashArea"><div class="loading">Carregando dados…</div></div>`;
  try{
    const [acc,tx,rec,pag]=await Promise.all([
      scopeQ(db.from('financial_accounts').select('saldo_inicial,company_id')),
      scopeQ(db.from('bank_transactions').select('tipo,valor,company_id')),
      scopeQ(db.from('vw_contas_receber').select('saldo,situacao,vencimento,descricao,company_id')),
      scopeQ(db.from('vw_contas_pagar').select('saldo,situacao,vencimento,descricao,company_id')),
    ]);
    for(const r of [acc,tx,rec,pag]) if(r.error) throw r.error;
    const A=acc.data||[],T=tx.data||[],R=rec.data||[],P=pag.data||[];
    const sum=(arr,f)=>arr.reduce((s,x)=>s+Number(f(x)||0),0);
    const saldoAtual=sum(A,x=>x.saldo_inicial)+sum(T.filter(t=>t.tipo==='entrada'),x=>x.valor)-sum(T.filter(t=>t.tipo==='saida'),x=>x.valor);
    const aberto=s=>!['recebido','pago','cancelado'].includes(s);
    const aReceber=sum(R.filter(r=>aberto(r.situacao)),x=>x.saldo);
    const aPagar=sum(P.filter(p=>aberto(p.situacao)),x=>x.saldo);
    const vencR=sum(R.filter(r=>r.situacao==='vencido'),x=>x.saldo);
    const vencP=sum(P.filter(p=>p.situacao==='vencido'),x=>x.saldo);
    const lim=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const recebPrev=sum(R.filter(r=>r.situacao==='a_vencer'&&r.vencimento<=lim),x=>x.saldo);
    const pagPrev=sum(P.filter(p=>p.situacao==='a_vencer'&&p.vencimento<=lim),x=>x.saldo);
    const cards=[
      {lbl:'Saldo atual',dot:'t',val:money(saldoAtual),cls:saldoAtual<0?'neg':''},
      {lbl:'Contas a receber',dot:'g',val:money(aReceber)},
      {lbl:'Contas a pagar',dot:'r',val:money(aPagar)},
      {lbl:'Resultado (rec − pag)',dot:'t',val:money(aReceber-aPagar),cls:(aReceber-aPagar)<0?'neg':'pos'},
      {lbl:'Recebimentos previstos (30d)',dot:'g',val:money(recebPrev)},
      {lbl:'Pagamentos previstos (30d)',dot:'a',val:money(pagPrev)},
      {lbl:'Vencido a receber',dot:'r',val:money(vencR),cls:vencR>0?'warn':''},
      {lbl:'Vencido a pagar',dot:'r',val:money(vencP),cls:vencP>0?'neg':''},
    ];
    const prox=[...R.filter(r=>r.situacao==='a_vencer').map(r=>({tipo:'receber',...r})),...P.filter(p=>p.situacao==='a_vencer').map(p=>({tipo:'pagar',...p}))]
      .sort((a,b)=>a.vencimento.localeCompare(b.vencimento)).slice(0,8);
    const venc=[...R.filter(r=>r.situacao==='vencido').map(r=>({tipo:'receber',...r})),...P.filter(p=>p.situacao==='vencido').map(p=>({tipo:'pagar',...p}))]
      .sort((a,b)=>daysLate(b.vencimento)-daysLate(a.vencimento)).slice(0,8);
    $('dashArea').innerHTML=`
      <div class="cards">${cards.map(c=>`<div class="kpi"><div class="lbl"><span class="dot ${c.dot}"></span>${c.lbl}</div><div class="val ${c.cls||''}">${c.val}</div></div>`).join('')}</div>
      <div class="grid2">
        <div class="panel"><h3><span class="dot t"></span>Próximos vencimentos</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th class="r">Valor</th></tr></thead><tbody>
          ${prox.length?prox.map(x=>`<tr><td>${esc(x.descricao)}</td><td><span class="pill ${x.tipo}">${x.tipo==='receber'?'A receber':'A pagar'}</span></td><td>${fmtDate(x.vencimento)}</td><td class="r">${money(x.saldo)}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nada a vencer.</div></td></tr>'}
          </tbody></table></div>
        <div class="panel"><h3><span class="dot r"></span>Contas vencidas</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Atraso</th><th class="r">Valor</th></tr></thead><tbody>
          ${venc.length?venc.map(x=>`<tr><td>${esc(x.descricao)}</td><td><span class="pill ${x.tipo}">${x.tipo==='receber'?'A receber':'A pagar'}</span></td><td>${daysLate(x.vencimento)} dias</td><td class="r">${money(x.saldo)}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nenhuma conta vencida. 👏</div></td></tr>'}
          </tbody></table></div>
      </div>`;
  }catch(err){
    $('dashArea').innerHTML=`<div class="panel"><div class="empty">Não foi possível carregar os dados.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}

let crCache={titles:[],byId:{}};
let crFilters={cliente:'',status:'',busca:''};
const openTitles=new Set();

async function renderContasReceber(){
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Contas a receber</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
      <button class="btn" id="btnNova">+ Nova conta a receber</button></div>
    <div class="updated">Títulos agrupados — clique numa linha para abrir as parcelas.</div>
    <div id="crFilters"></div>
    <div id="crArea"><div class="loading">Carregando…</div></div>`;
  $('btnNova').onclick=openNovaReceber;
  await loadReceber();
}

async function loadReceber(){
  try{
    const [recs,insts]=await Promise.all([
      scopeQ(db.from('receivables').select('id,customer_id,descricao,documento,valor_total,status,created_at,company_id,customers(razao_social,nome_fantasia)')).order('created_at',{ascending:false}),
      scopeQ(db.from('vw_contas_receber').select('id,receivable_id,numero,total_parcelas,competencia,vencimento,valor,valor_recebido,saldo,situacao')),
    ]);
    if(recs.error) throw recs.error; if(insts.error) throw insts.error;
    const byRec={}; (insts.data||[]).forEach(i=>{(byRec[i.receivable_id]=byRec[i.receivable_id]||[]).push(i);});
    Object.values(byRec).forEach(arr=>arr.sort((a,b)=>a.numero-b.numero));
    const titles=(recs.data||[]).map(r=>{
      const parc=byRec[r.id]||[];
      const cliente=r.customers?(r.customers.nome_fantasia||r.customers.razao_social):'—';
      const recebido=parc.reduce((s,p)=>s+Number(p.valor_recebido||0),0);
      const saldo=parc.reduce((s,p)=>s+Number(p.saldo||0),0);
      const temVencido=parc.some(p=>p.situacao==='vencido');
      return {...r,cliente,parc,recebido,saldo,temVencido};
    });
    crCache={titles,byId:Object.fromEntries(titles.map(t=>[t.id,t]))};
    renderCrFilters(); drawReceber();
  }catch(err){
    $('crArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}

function renderCrFilters(){
  const clientes=[...new Map(crCache.titles.filter(t=>t.customer_id).map(t=>[t.customer_id,t.cliente])).entries()];
  $('crFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Cliente</label><select id="fCli"><option value="">Todos</option>${clientes.map(([id,n])=>`<option value="${id}" ${crFilters.cliente===id?'selected':''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="fg"><label>Situação</label><select id="fSt">
      <option value="">Todas</option>
      <option value="aberto" ${crFilters.status==='aberto'?'selected':''}>Em aberto</option>
      <option value="vencido" ${crFilters.status==='vencido'?'selected':''}>Com vencido</option>
      <option value="quitado" ${crFilters.status==='quitado'?'selected':''}>Quitados</option>
      <option value="cancelado" ${crFilters.status==='cancelado'?'selected':''}>Cancelados</option></select></div>
    <div class="fg"><label>Buscar descrição</label><input id="fBusca" placeholder="ex: consultoria" value="${esc(crFilters.busca)}"></div>
  </div>`;
  $('fCli').onchange=e=>{crFilters.cliente=e.target.value;drawReceber();};
  $('fSt').onchange=e=>{crFilters.status=e.target.value;drawReceber();};
  $('fBusca').oninput=e=>{crFilters.busca=e.target.value;drawReceber();};
}

function drawReceber(){
  let rows=crCache.titles;
  if(crFilters.cliente) rows=rows.filter(t=>t.customer_id===crFilters.cliente);
  if(crFilters.busca) rows=rows.filter(t=>(t.descricao||'').toLowerCase().includes(crFilters.busca.toLowerCase()));
  if(crFilters.status==='vencido') rows=rows.filter(t=>t.temVencido);
  else if(crFilters.status) rows=rows.filter(t=>t.status===crFilters.status);

  if(!rows.length){ $('crArea').innerHTML='<div class="panel"><div class="empty">Nenhuma conta a receber encontrada.</div></div>'; return; }

  const body=rows.map(t=>{
    const open=openTitles.has(t.id);
    const stKey=t.temVencido&&t.status==='aberto'?'vencido':t.status;
    const titleRow=`<tr class="title-row" data-id="${t.id}">
      <td><span class="caret ${open?'open':''}">▶</span>${esc(t.cliente)}</td>
      <td>${esc(t.descricao)}</td>
      <td>${esc(t.documento||'—')}</td>
      <td>${t.parc.length>1?t.parc.length+'x':'à vista'}</td>
      <td class="r">${money(t.valor_total)}</td>
      <td class="r">${money(t.recebido)}</td>
      <td class="r">${money(t.saldo)}</td>
      <td><span class="pill st-${stKey}">${STLABEL[stKey]||stKey}</span></td></tr>`;
    let instRows='';
    if(open){
      instRows=t.parc.map(p=>{
        const canBaixa=!['recebido','cancelado'].includes(p.situacao)&&Number(p.saldo)>0;
        return `<tr class="inst-row"><td colspan="3" style="padding-left:38px">Parcela ${p.numero}/${p.total_parcelas} · venc. ${fmtDate(p.vencimento)}</td>
          <td><span class="pill st-${p.situacao}">${STLABEL[p.situacao]||p.situacao}</span></td>
          <td class="r">${money(p.valor)}</td><td class="r">${money(p.valor_recebido)}</td><td class="r">${money(p.saldo)}</td>
          <td>${canBaixa?`<button class="mini" data-baixa="${p.id}">Receber</button>`:'—'}</td></tr>`;
      }).join('');
    }
    return titleRow+instRows;
  }).join('');

  $('crArea').innerHTML=`<div class="panel"><table>
    <thead><tr><th>Cliente</th><th>Descrição</th><th>Documento</th><th>Parc.</th>
      <th class="r">Valor</th><th class="r">Recebido</th><th class="r">Saldo</th><th>Situação</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;

  $('crArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const id=tr.dataset.id; openTitles.has(id)?openTitles.delete(id):openTitles.add(id); drawReceber();
  });
  $('crArea').querySelectorAll('[data-baixa]').forEach(b=>b.onclick=e=>{
    e.stopPropagation(); openBaixa(b.dataset.baixa);
  });
}

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
async function openNovaReceber(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Nova conta a receber</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa</label><select id="nCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label>Cliente</label><select id="nCli"><option value="">—</option></select></div>
        <div class="field"><label>Documento</label><input id="nDoc" placeholder="NF, contrato…"></div>
      </div>
      <div class="field"><label>Descrição *</label><input id="nDesc" placeholder="ex: Consultoria mensal"></div>
      <div class="row2">
        <div class="field"><label>Categoria</label><select id="nCat"><option value="">—</option></select></div>
        <div class="field"><label>Centro de custo</label><select id="nCC"><option value="">—</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Conta financeira</label><select id="nAcc"><option value="">—</option></select></div>
        <div class="field"><label>Forma de recebimento</label><select id="nForma">
          <option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option>
          <option value="transferencia">Transferência</option><option value="cartao">Cartão</option>
          <option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Valor total *</label><input id="nVal" type="number" step="0.01" min="0" placeholder="0,00"></div>
        <div class="field"><label>Data de emissão</label><input id="nEmis" type="date" value="${todayStr()}"></div>
      </div>
      <div class="field"><label>Tipo</label>
        <div class="seg"><button type="button" id="tVista" class="on">À vista</button><button type="button" id="tParc">Parcelado</button></div></div>
      <div class="row2">
        <div class="field"><label>1º vencimento *</label><input id="nVenc" type="date" value="${todayStr()}"></div>
        <div class="field" id="wrapParc" style="display:none"><label>Qtd. parcelas</label><input id="nQtd" type="number" min="2" value="2"></div>
      </div>
      <div class="field" id="wrapInt" style="display:none"><label>Intervalo entre parcelas (meses)</label><input id="nInt" type="number" min="1" value="1"><div class="hint">Ex.: 12 parcelas com intervalo 1 = mensais (1/12, 2/12…).</div></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  let tipo='a_vista';
  $('tVista').onclick=()=>{tipo='a_vista';$('tVista').classList.add('on');$('tParc').classList.remove('on');$('wrapParc').style.display='none';$('wrapInt').style.display='none';};
  $('tParc').onclick=()=>{tipo='parcelado';$('tParc').classList.add('on');$('tVista').classList.remove('on');$('wrapParc').style.display='';$('wrapInt').style.display='';};

  await fillNovaSelects(defaultCo);
  $('nCo').onchange=()=>fillNovaSelects($('nCo').value);

  $('mSave').onclick=async ()=>{
    const desc=$('nDesc').value.trim(), val=parseFloat($('nVal').value);
    if(!desc){ toast('Informe a descrição.','err'); return; }
    if(!(val>0)){ toast('Informe um valor válido.','err'); return; }
    if(!$('nVenc').value){ toast('Informe o 1º vencimento.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const params={
      p_company_id:$('nCo').value, p_customer_id:$('nCli').value||null, p_descricao:desc,
      p_valor_total:val, p_primeiro_vencimento:$('nVenc').value,
      p_qtd_parcelas: tipo==='parcelado'?parseInt($('nQtd').value||'1'):1,
      p_intervalo_meses: tipo==='parcelado'?parseInt($('nInt').value||'1'):1,
      p_categoria_id:$('nCat').value||null, p_cost_center_id:$('nCC').value||null,
      p_financial_account_id:$('nAcc').value||null, p_documento:$('nDoc').value||null,
      p_forma_recebimento:$('nForma').value||null, p_data_emissao:$('nEmis').value||null,
    };
    const { error }=await db.rpc('criar_conta_receber',params);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(error){ toast('Erro ao salvar: '+error.message,'err'); return; }
    closeModal(); toast('Conta a receber criada!'); loadReceber();
  };
}
async function fillNovaSelects(co){
  if(!co) return;
  const [cli,cat,cc,acc]=await Promise.all([
    db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('categories').select('id,nome,tipo').eq('company_id',co).eq('tipo','receita').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
  $('nCli').innerHTML=opt(cli,x=>x.nome_fantasia||x.razao_social);
  $('nCat').innerHTML=opt(cat,x=>x.nome);
  $('nCC').innerHTML=opt(cc,x=>x.nome);
  $('nAcc').innerHTML=opt(acc,x=>x.nome);
}

async function openBaixa(instId){
  let inst=null;
  for(const t of crCache.titles){ const p=t.parc.find(x=>x.id===instId); if(p){inst={...p,cliente:t.cliente,descricao:t.descricao,company_id:t.company_id};break;} }
  if(!inst){ toast('Parcela não encontrada.','err'); return; }
  const co=inst.company_id||companyId||(companies[0]&&companies[0].id);
  const accRes=await db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome');
  const accs=accRes.data||[];
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Receber parcela</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="box"><b>${esc(inst.descricao)}</b> — ${esc(inst.cliente)}<br>
        Parcela ${inst.numero}/${inst.total_parcelas} · venc. ${fmtDate(inst.vencimento)}<br>
        Valor ${money(inst.valor)} · já recebido ${money(inst.valor_recebido)} · <b>saldo ${money(inst.saldo)}</b></div>
      <div class="field"><label>Valor a receber *</label><input id="bVal" type="number" step="0.01" min="0" max="${inst.saldo}" value="${Number(inst.saldo).toFixed(2)}"><div class="hint">Pode receber menos que o saldo (recebimento parcial).</div></div>
      <div class="row2">
        <div class="field"><label>Data *</label><input id="bData" type="date" value="${todayStr()}"></div>
        <div class="field"><label>Conta financeira *</label><select id="bAcc"><option value="">—</option>${accs.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Forma</label><select id="bForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      <div class="field"><label>Observação</label><input id="bObs" placeholder="opcional"></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Confirmar recebimento</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const val=parseFloat($('bVal').value);
    if(!(val>0)){ toast('Informe o valor.','err'); return; }
    if(val>Number(inst.saldo)+0.005){ toast('Valor maior que o saldo da parcela.','err'); return; }
    if(!$('bAcc').value){ toast('Selecione a conta financeira.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Confirmando…';
    const { error }=await db.rpc('baixar_receivable_installment',{
      p_installment_id:instId, p_valor:val, p_financial_account_id:$('bAcc').value,
      p_data:$('bData').value||todayStr(), p_forma:$('bForma').value||null, p_observacao:$('bObs').value||null,
    });
    $('mSave').disabled=false; $('mSave').textContent='Confirmar recebimento';
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast('Recebimento registrado!'); loadReceber();
  };
}

/* ===================== CONTAS A PAGAR ===================== */
let cpCache={titles:[]};
let cpFilters={forn:'',status:'',busca:''};
const openTitlesP=new Set();

async function renderContasPagar(){
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Contas a pagar</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
      <button class="btn" id="btnNovaP">+ Nova conta a pagar</button></div>
    <div class="updated">Títulos agrupados — clique numa linha para abrir as parcelas.</div>
    <div id="cpFilters"></div>
    <div id="cpArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaP').onclick=openNovaPagar;
  await loadPagar();
}

async function loadPagar(){
  try{
    const [pays,insts]=await Promise.all([
      scopeQ(db.from('payables').select('id,supplier_id,descricao,documento,valor_total,status,created_at,company_id,suppliers(razao_social,nome_fantasia)')).order('created_at',{ascending:false}),
      scopeQ(db.from('vw_contas_pagar').select('id,payable_id,numero,total_parcelas,competencia,vencimento,valor,valor_pago,saldo,situacao')),
    ]);
    if(pays.error) throw pays.error; if(insts.error) throw insts.error;
    const byPay={}; (insts.data||[]).forEach(i=>{(byPay[i.payable_id]=byPay[i.payable_id]||[]).push(i);});
    Object.values(byPay).forEach(arr=>arr.sort((a,b)=>a.numero-b.numero));
    const titles=(pays.data||[]).map(p=>{
      const parc=byPay[p.id]||[];
      const forn=p.suppliers?(p.suppliers.nome_fantasia||p.suppliers.razao_social):'—';
      const pago=parc.reduce((s,x)=>s+Number(x.valor_pago||0),0);
      const saldo=parc.reduce((s,x)=>s+Number(x.saldo||0),0);
      const temVencido=parc.some(x=>x.situacao==='vencido');
      return {...p,forn,parc,pago,saldo,temVencido};
    });
    cpCache={titles};
    renderCpFilters(); drawPagar();
  }catch(err){
    $('cpArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}

function renderCpFilters(){
  const forns=[...new Map(cpCache.titles.filter(t=>t.supplier_id).map(t=>[t.supplier_id,t.forn])).entries()];
  $('cpFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Fornecedor</label><select id="pFor"><option value="">Todos</option>${forns.map(([id,n])=>`<option value="${id}" ${cpFilters.forn===id?'selected':''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="fg"><label>Situação</label><select id="pSt">
      <option value="">Todas</option>
      <option value="aberto" ${cpFilters.status==='aberto'?'selected':''}>Em aberto</option>
      <option value="vencido" ${cpFilters.status==='vencido'?'selected':''}>Com vencido</option>
      <option value="quitado" ${cpFilters.status==='quitado'?'selected':''}>Quitados</option>
      <option value="cancelado" ${cpFilters.status==='cancelado'?'selected':''}>Cancelados</option></select></div>
    <div class="fg"><label>Buscar descrição</label><input id="pBusca" placeholder="ex: aluguel" value="${esc(cpFilters.busca)}"></div>
  </div>`;
  $('pFor').onchange=e=>{cpFilters.forn=e.target.value;drawPagar();};
  $('pSt').onchange=e=>{cpFilters.status=e.target.value;drawPagar();};
  $('pBusca').oninput=e=>{cpFilters.busca=e.target.value;drawPagar();};
}

function drawPagar(){
  let rows=cpCache.titles;
  if(cpFilters.forn) rows=rows.filter(t=>t.supplier_id===cpFilters.forn);
  if(cpFilters.busca) rows=rows.filter(t=>(t.descricao||'').toLowerCase().includes(cpFilters.busca.toLowerCase()));
  if(cpFilters.status==='vencido') rows=rows.filter(t=>t.temVencido);
  else if(cpFilters.status) rows=rows.filter(t=>t.status===cpFilters.status);

  if(!rows.length){ $('cpArea').innerHTML='<div class="panel"><div class="empty">Nenhuma conta a pagar encontrada.</div></div>'; return; }

  const body=rows.map(t=>{
    const open=openTitlesP.has(t.id);
    const stKey=t.temVencido&&t.status==='aberto'?'vencido':t.status;
    const titleRow=`<tr class="title-row" data-id="${t.id}">
      <td><span class="caret ${open?'open':''}">▶</span>${esc(t.forn)}</td>
      <td>${esc(t.descricao)}</td>
      <td>${esc(t.documento||'—')}</td>
      <td>${t.parc.length>1?t.parc.length+'x':'à vista'}</td>
      <td class="r">${money(t.valor_total)}</td>
      <td class="r">${money(t.pago)}</td>
      <td class="r">${money(t.saldo)}</td>
      <td><span class="pill st-${stKey}">${STLABEL[stKey]||stKey}</span></td></tr>`;
    let instRows='';
    if(open){
      instRows=t.parc.map(p=>{
        const canBaixa=!['pago','cancelado'].includes(p.situacao)&&Number(p.saldo)>0;
        return `<tr class="inst-row"><td colspan="3" style="padding-left:38px">Parcela ${p.numero}/${p.total_parcelas} · venc. ${fmtDate(p.vencimento)}</td>
          <td><span class="pill st-${p.situacao}">${STLABEL[p.situacao]||p.situacao}</span></td>
          <td class="r">${money(p.valor)}</td><td class="r">${money(p.valor_pago)}</td><td class="r">${money(p.saldo)}</td>
          <td>${canBaixa?`<button class="mini" data-pagar="${p.id}">Pagar</button>`:'—'}</td></tr>`;
      }).join('');
    }
    return titleRow+instRows;
  }).join('');

  $('cpArea').innerHTML=`<div class="panel"><table>
    <thead><tr><th>Fornecedor</th><th>Descrição</th><th>Documento</th><th>Parc.</th>
      <th class="r">Valor</th><th class="r">Pago</th><th class="r">Saldo</th><th>Situação</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;

  $('cpArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const id=tr.dataset.id; openTitlesP.has(id)?openTitlesP.delete(id):openTitlesP.add(id); drawPagar();
  });
  $('cpArea').querySelectorAll('[data-pagar]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openPagar(b.dataset.pagar); });
}

/* ---------- MODAL: NOVA CONTA A PAGAR ---------- */
async function openNovaPagar(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Nova conta a pagar</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa</label><select id="pnCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label>Fornecedor</label><select id="pnFor"><option value="">—</option></select></div>
        <div class="field"><label>Documento</label><input id="pnDoc" placeholder="NF, boleto…"></div>
      </div>
      <div class="field"><label>Descrição *</label><input id="pnDesc" placeholder="ex: Aluguel do galpão"></div>
      <div class="row2">
        <div class="field"><label>Categoria</label><select id="pnCat"><option value="">—</option></select></div>
        <div class="field"><label>Centro de custo</label><select id="pnCC"><option value="">—</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Conta financeira</label><select id="pnAcc"><option value="">—</option></select></div>
        <div class="field"><label>Forma de pagamento</label><select id="pnForma">
          <option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option>
          <option value="transferencia">Transferência</option><option value="cartao">Cartão</option>
          <option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Valor total *</label><input id="pnVal" type="number" step="0.01" min="0" placeholder="0,00"></div>
        <div class="field"><label>Data de emissão</label><input id="pnEmis" type="date" value="${todayStr()}"></div>
      </div>
      <div class="field"><label>Tipo</label>
        <div class="seg"><button type="button" id="ptVista" class="on">À vista</button><button type="button" id="ptParc">Parcelado</button></div></div>
      <div class="row2">
        <div class="field"><label>1º vencimento *</label><input id="pnVenc" type="date" value="${todayStr()}"></div>
        <div class="field" id="pwrapParc" style="display:none"><label>Qtd. parcelas</label><input id="pnQtd" type="number" min="2" value="2"></div>
      </div>
      <div class="field" id="pwrapInt" style="display:none"><label>Intervalo entre parcelas (meses)</label><input id="pnInt" type="number" min="1" value="1"><div class="hint">Ex.: 12 parcelas com intervalo 1 = mensais.</div></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  let tipo='a_vista';
  $('ptVista').onclick=()=>{tipo='a_vista';$('ptVista').classList.add('on');$('ptParc').classList.remove('on');$('pwrapParc').style.display='none';$('pwrapInt').style.display='none';};
  $('ptParc').onclick=()=>{tipo='parcelado';$('ptParc').classList.add('on');$('ptVista').classList.remove('on');$('pwrapParc').style.display='';$('pwrapInt').style.display='';};

  await fillNovaPagarSelects(defaultCo);
  $('pnCo').onchange=()=>fillNovaPagarSelects($('pnCo').value);

  $('mSave').onclick=async ()=>{
    const desc=$('pnDesc').value.trim(), val=parseFloat($('pnVal').value);
    if(!desc){ toast('Informe a descrição.','err'); return; }
    if(!(val>0)){ toast('Informe um valor válido.','err'); return; }
    if(!$('pnVenc').value){ toast('Informe o 1º vencimento.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const params={
      p_company_id:$('pnCo').value, p_supplier_id:$('pnFor').value||null, p_descricao:desc,
      p_valor_total:val, p_primeiro_vencimento:$('pnVenc').value,
      p_qtd_parcelas: tipo==='parcelado'?parseInt($('pnQtd').value||'1'):1,
      p_intervalo_meses: tipo==='parcelado'?parseInt($('pnInt').value||'1'):1,
      p_categoria_id:$('pnCat').value||null, p_cost_center_id:$('pnCC').value||null,
      p_financial_account_id:$('pnAcc').value||null, p_documento:$('pnDoc').value||null,
      p_forma_pagamento:$('pnForma').value||null, p_data_emissao:$('pnEmis').value||null,
    };
    const { error }=await db.rpc('criar_conta_pagar',params);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(error){ toast('Erro ao salvar: '+error.message,'err'); return; }
    closeModal(); toast('Conta a pagar criada!'); loadPagar();
  };
}
async function fillNovaPagarSelects(co){
  if(!co) return;
  const [forn,cat,cc,acc]=await Promise.all([
    db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('categories').select('id,nome,tipo').eq('company_id',co).eq('tipo','despesa').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
  $('pnFor').innerHTML=opt(forn,x=>x.nome_fantasia||x.razao_social);
  $('pnCat').innerHTML=opt(cat,x=>x.nome);
  $('pnCC').innerHTML=opt(cc,x=>x.nome);
  $('pnAcc').innerHTML=opt(acc,x=>x.nome);
}

/* ---------- MODAL: BAIXA (PAGAR) ---------- */
async function openPagar(instId){
  let inst=null;
  for(const t of cpCache.titles){ const p=t.parc.find(x=>x.id===instId); if(p){inst={...p,forn:t.forn,descricao:t.descricao,company_id:t.company_id};break;} }
  if(!inst){ toast('Parcela não encontrada.','err'); return; }
  const co=inst.company_id||companyId||(companies[0]&&companies[0].id);
  const accRes=await db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome');
  const accs=accRes.data||[];
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Pagar parcela</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="box"><b>${esc(inst.descricao)}</b> — ${esc(inst.forn)}<br>
        Parcela ${inst.numero}/${inst.total_parcelas} · venc. ${fmtDate(inst.vencimento)}<br>
        Valor ${money(inst.valor)} · já pago ${money(inst.valor_pago)} · <b>saldo ${money(inst.saldo)}</b></div>
      <div class="field"><label>Valor a pagar *</label><input id="bVal" type="number" step="0.01" min="0" max="${inst.saldo}" value="${Number(inst.saldo).toFixed(2)}"><div class="hint">Pode pagar menos que o saldo (pagamento parcial).</div></div>
      <div class="row2">
        <div class="field"><label>Data *</label><input id="bData" type="date" value="${todayStr()}"></div>
        <div class="field"><label>Conta financeira *</label><select id="bAcc"><option value="">—</option>${accs.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Forma</label><select id="bForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      <div class="field"><label>Observação</label><input id="bObs" placeholder="opcional"></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Confirmar pagamento</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const val=parseFloat($('bVal').value);
    if(!(val>0)){ toast('Informe o valor.','err'); return; }
    if(val>Number(inst.saldo)+0.005){ toast('Valor maior que o saldo da parcela.','err'); return; }
    if(!$('bAcc').value){ toast('Selecione a conta financeira.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Confirmando…';
    const { error }=await db.rpc('baixar_payable_installment',{
      p_installment_id:instId, p_valor:val, p_financial_account_id:$('bAcc').value,
      p_data:$('bData').value||todayStr(), p_forma:$('bForma').value||null, p_observacao:$('bObs').value||null,
    });
    $('mSave').disabled=false; $('mSave').textContent='Confirmar pagamento';
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast('Pagamento registrado!'); loadPagar();
  };
}

/* ===================== CADASTROS ===================== */
const coName = id => { const c=companies.find(x=>x.id===id); return c?(c.nome_fantasia||c.razao_social):'—'; };
const TIPO_ACC={conta_corrente:'Conta corrente',poupanca:'Poupança',investimento:'Investimento',caixa:'Caixa'};
function statusPill(s){ return `<span class="pill st-${s==='ativo'?'quitado':'cancelado'}">${s==='ativo'?'Ativo':'Inativo'}</span>`; }

const CAD={
  clientes:{table:'customers',title:'Clientes',singular:'cliente',orderBy:'razao_social',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome_fantasia||r.razao_social)},
      {label:'CPF/CNPJ',get:r=>esc(r.cpf_cnpj||'—')},
      {label:'Telefone',get:r=>esc(r.telefone||'—')},
      {label:'Cidade/UF',get:r=>esc([r.cidade,r.estado].filter(Boolean).join('/')||'—')},
      {label:'Status',get:r=>statusPill(r.status)},
    ],
    fields:[
      {k:'razao_social',l:'Razão social / Nome',req:true,col:2},
      {k:'nome_fantasia',l:'Nome fantasia'},{k:'cpf_cnpj',l:'CPF/CNPJ'},
      {k:'email',l:'E-mail'},{k:'telefone',l:'Telefone'},
      {k:'cep',l:'CEP'},{k:'endereco',l:'Endereço',col:2},
      {k:'numero',l:'Número'},{k:'complemento',l:'Complemento'},
      {k:'bairro',l:'Bairro'},{k:'cidade',l:'Cidade'},{k:'estado',l:'UF'},
      {k:'observacoes',l:'Observações',type:'textarea',col:2},
      {k:'status',l:'Status',type:'select',opts:[['ativo','Ativo'],['inativo','Inativo']],def:'ativo'},
    ]},
  fornecedores:{table:'suppliers',title:'Fornecedores',singular:'fornecedor',orderBy:'razao_social',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome_fantasia||r.razao_social)},
      {label:'CPF/CNPJ',get:r=>esc(r.cpf_cnpj||'—')},
      {label:'Telefone',get:r=>esc(r.telefone||'—')},
      {label:'Cidade/UF',get:r=>esc([r.cidade,r.estado].filter(Boolean).join('/')||'—')},
      {label:'Status',get:r=>statusPill(r.status)},
    ],
    fields:[
      {k:'razao_social',l:'Razão social / Nome',req:true,col:2},
      {k:'nome_fantasia',l:'Nome fantasia'},{k:'cpf_cnpj',l:'CPF/CNPJ'},
      {k:'email',l:'E-mail'},{k:'telefone',l:'Telefone'},
      {k:'cep',l:'CEP'},{k:'endereco',l:'Endereço',col:2},
      {k:'numero',l:'Número'},{k:'complemento',l:'Complemento'},
      {k:'bairro',l:'Bairro'},{k:'cidade',l:'Cidade'},{k:'estado',l:'UF'},
      {k:'observacoes',l:'Observações',type:'textarea',col:2},
      {k:'status',l:'Status',type:'select',opts:[['ativo','Ativo'],['inativo','Inativo']],def:'ativo'},
    ]},
  'centros-custo':{table:'cost_centers',title:'Centros de custo',singular:'centro de custo',orderBy:'nome',asc:true,
    columns:[{label:'Nome',get:r=>esc(r.nome)}],
    fields:[{k:'nome',l:'Nome',req:true,col:2}]},
  'contas-financeiras':{table:'financial_accounts',title:'Contas financeiras',singular:'conta financeira',orderBy:'nome',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome)},
      {label:'Tipo',get:r=>TIPO_ACC[r.tipo]||r.tipo},
      {label:'Banco',get:r=>esc(r.banco||'—')},
      {label:'Saldo inicial',get:r=>money(r.saldo_inicial),r:true},
    ],
    fields:[
      {k:'nome',l:'Nome',req:true,col:2},
      {k:'tipo',l:'Tipo',type:'select',req:true,def:'conta_corrente',
        opts:[['conta_corrente','Conta corrente'],['poupanca','Poupança'],['investimento','Investimento'],['caixa','Caixa']]},
      {k:'banco',l:'Banco'},{k:'agencia',l:'Agência'},{k:'numero',l:'Número'},
      {k:'saldo_inicial',l:'Saldo inicial',type:'number',def:'0'},
      {k:'data_saldo_inicial',l:'Data do saldo inicial',type:'date'},
    ]},
};

async function renderCadastro(key){
  const cfg=CAD[key];
  $('main').innerHTML=`<div class="page-h"><h1>${cfg.title}</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovoCad">+ Novo ${cfg.singular}</button></div>
    <div class="updated">Cadastros da empresa selecionada.</div>
    <div id="cadArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovoCad').onclick=()=>openCadForm(key,null);
  await loadCad(key);
}
async function loadCad(key){
  const cfg=CAD[key];
  const { data,error }=await scopeQ(db.from(cfg.table).select('*')).order(cfg.orderBy,{ascending:cfg.asc});
  if(error){ $('cadArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  cfg._rows=data||[]; drawCad(key);
}
function drawCad(key){
  const cfg=CAD[key], rows=cfg._rows;
  if(!rows.length){ $('cadArea').innerHTML=`<div class="panel"><div class="empty">Nenhum ${cfg.singular} cadastrado ainda. Clique em “+ Novo ${cfg.singular}”.</div></div>`; return; }
  const showCo=!companyId;
  const head=`<tr>${showCo?'<th>Empresa</th>':''}${cfg.columns.map(c=>`<th class="${c.r?'r':''}">${c.label}</th>`).join('')}<th></th></tr>`;
  const body=rows.map((r,i)=>`<tr>${showCo?`<td>${esc(coName(r.company_id))}</td>`:''}${cfg.columns.map(c=>`<td class="${c.r?'r':''}">${c.get(r)}</td>`).join('')}
    <td><div class="act"><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('cadArea').innerHTML=`<div class="panel"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  $('cadArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openCadForm(key,rows[+b.dataset.edit]));
  $('cadArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delCad(key,rows[+b.dataset.del]));
}
function cadFieldHTML(f,val){
  const v=val==null?(f.def!=null?f.def:''):val;
  const span=f.col===2?'style="grid-column:1/3"':'';
  if(f.type==='select') return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><select data-k="${f.k}">${f.opts.map(o=>`<option value="${o[0]}" ${String(v)===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></div>`;
  if(f.type==='textarea') return `<div class="field" ${span}><label>${f.l}</label><textarea data-k="${f.k}" rows="2">${esc(v)}</textarea></div>`;
  const t=f.type==='number'?'number':(f.type==='date'?'date':'text');
  return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><input data-k="${f.k}" type="${t}" ${f.type==='number'?'step="0.01"':''} value="${esc(v)}"></div>`;
}
function openCadForm(key,rec){
  const cfg=CAD[key], creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field" style="grid-column:1/3"><label>Empresa *</label><select id="cadCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Novo':'Editar'} ${cfg.singular}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">${coField}${cfg.fields.map(f=>cadFieldHTML(f,rec?rec[f.k]:null)).join('')}</div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const payload={};
    document.querySelectorAll('#modalRoot [data-k]').forEach(inp=>{ let v=inp.value; payload[inp.dataset.k]=(v===''?null:v); });
    for(const f of cfg.fields) if(f.req && !payload[f.k]){ toast('Preencha: '+f.l,'err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    let res;
    if(creating){ payload.company_id=$('cadCo').value; res=await db.from(cfg.table).insert(payload); }
    else res=await db.from(cfg.table).update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast(cfg.singular[0].toUpperCase()+cfg.singular.slice(1)+(creating?' criado!':' atualizado!')); loadCad(key);
  };
}
async function delCad(key,rec){
  const cfg=CAD[key];
  const nome=rec.nome_fantasia||rec.razao_social||rec.nome||'este registro';
  const ok=await confirmModal({titulo:`Excluir ${cfg.singular}`, texto:`Deseja excluir “${nome}”? Esta ação não pode ser desfeita.`, ok:'Excluir', perigo:true});
  if(!ok) return;
  const { error }=await db.from(cfg.table).delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir (pode estar em uso). '+ (error.message||''),'err'); return; }
  toast('Excluído.'); loadCad(key);
}

/* ---------- CATEGORIAS (hierárquicas) ---------- */
let catRows=[];
async function renderCategorias(){
  $('main').innerHTML=`<div class="page-h"><h1>Categorias</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovaCat">+ Nova categoria</button></div>
    <div class="updated">Receitas e despesas. Pode ter categoria-pai (hierarquia).</div>
    <div id="catArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaCat').onclick=()=>openCatForm(null);
  await loadCategorias();
}
async function loadCategorias(){
  const { data,error }=await scopeQ(db.from('categories').select('*')).order('nome',{ascending:true});
  if(error){ $('catArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  catRows=data||[]; drawCategorias();
}
function drawCategorias(){
  if(!catRows.length){ $('catArea').innerHTML='<div class="panel"><div class="empty">Nenhuma categoria. Clique em “+ Nova categoria”.</div></div>'; return; }
  const nameById=Object.fromEntries(catRows.map(c=>[c.id,c.nome]));
  const showCo=!companyId;
  const render=tipo=>{
    const rows=catRows.filter(c=>c.tipo===tipo);
    if(!rows.length) return '';
    // pais primeiro, depois filhos
    const ordered=[...rows.filter(r=>!r.parent_id),...rows.filter(r=>r.parent_id)];
    const body=ordered.map(c=>{
      const idx=catRows.indexOf(c);
      const nome=c.parent_id?`&nbsp;&nbsp;↳ ${esc(c.nome)}`:`<b>${esc(c.nome)}</b>`;
      return `<tr>${showCo?`<td>${esc(coName(c.company_id))}</td>`:''}<td>${nome}</td><td>${c.parent_id?esc(nameById[c.parent_id]||'—'):'—'}</td>
        <td><div class="act"><button class="lnk" data-edit="${idx}">Editar</button><button class="lnk del" data-del="${idx}">Excluir</button></div></td></tr>`;
    }).join('');
    return `<div class="panel" style="margin-bottom:16px"><h3><span class="dot ${tipo==='receita'?'g':'r'}"></span>${tipo==='receita'?'Receitas':'Despesas'}</h3>
      <table><thead><tr>${showCo?'<th>Empresa</th>':''}<th>Categoria</th><th>Categoria-pai</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  $('catArea').innerHTML=render('receita')+render('despesa');
  $('catArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openCatForm(catRows[+b.dataset.edit]));
  $('catArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delCat(catRows[+b.dataset.del]));
}
function openCatForm(rec){
  const creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field"><label>Empresa *</label><select id="catCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} categoria</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      ${coField}
      <div class="field"><label>Nome *</label><input id="catNome" value="${esc(rec?rec.nome:'')}"></div>
      <div class="field"><label>Tipo *</label><select id="catTipo">
        <option value="receita" ${rec&&rec.tipo==='receita'?'selected':''}>Receita</option>
        <option value="despesa" ${!rec||rec.tipo==='despesa'?'selected':''}>Despesa</option></select></div>
      <div class="field"><label>Categoria-pai (opcional)</label><select id="catPai"><option value="">— nenhuma —</option></select></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const co=()=> creating?$('catCo').value:rec.company_id;
  async function fillPai(){
    const { data }=await db.from('categories').select('id,nome,tipo,parent_id').eq('company_id',co()).eq('tipo',$('catTipo').value).order('nome');
    const opts=(data||[]).filter(c=>!c.parent_id && (!rec||c.id!==rec.id)); // só pais de 1º nível, e não a própria
    $('catPai').innerHTML='<option value="">— nenhuma —</option>'+opts.map(c=>`<option value="${c.id}" ${rec&&rec.parent_id===c.id?'selected':''}>${esc(c.nome)}</option>`).join('');
  }
  fillPai();
  $('catTipo').onchange=fillPai;
  if(creating) $('catCo').onchange=fillPai;
  $('mSave').onclick=async ()=>{
    const nome=$('catNome').value.trim();
    if(!nome){ toast('Informe o nome.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ nome, tipo:$('catTipo').value, parent_id:$('catPai').value||null };
    let res;
    if(creating){ payload.company_id=$('catCo').value; res=await db.from('categories').insert(payload); }
    else res=await db.from('categories').update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast('Categoria '+(creating?'criada!':'atualizada!')); loadCategorias();
  };
}
async function delCat(rec){
  const ok=await confirmModal({titulo:'Excluir categoria', texto:`Deseja excluir a categoria “${rec.nome}”?`, ok:'Excluir', perigo:true});
  if(!ok) return;
  const { error }=await db.from('categories').delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir (pode estar em uso).','err'); return; }
  toast('Excluída.'); loadCategorias();
}

/* ===================== FLUXO DE CAIXA ===================== */
const MES3=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const ymOf = d => (d||'').slice(0,7);
const ymLabel = ym => { const [y,m]=ym.split('-'); return MES3[+m-1]+'/'+y.slice(2); };
function ymAdd(ym,n){ let [y,m]=ym.split('-').map(Number); m=m-1+n; y+=Math.floor(m/12); m=((m%12)+12)%12; return `${y}-${String(m+1).padStart(2,'0')}`; }
function monthsRange(keys){ if(!keys.length) return []; const s=keys.slice().sort(); let cur=s[0]; const end=s[s.length-1], out=[]; let guard=0; while(cur<=end && guard++<240){ out.push(cur); cur=ymAdd(cur,1);} return out; }

let fluxoData=null, fluxoMode='ambos'; let openFluxo=new Set();
async function renderFluxo(){
  $('main').innerHTML=`<div class="page-h"><h1>Fluxo de caixa</h1><span class="scope">${companyId?'':'· consolidado (todas as empresas)'}</span></div>
    <div class="updated">Saldo por mês. Alterne entre realizado, previsto e os dois juntos.</div>
    <div class="seg" style="max-width:520px;margin-bottom:20px">
      <button type="button" data-mode="realizado">Realizado</button>
      <button type="button" data-mode="previsto">Previsto</button>
      <button type="button" data-mode="ambos">Realizado + Previsto</button>
    </div>
    <div id="fluxoArea"><div class="loading">Carregando…</div></div>`;
  document.querySelectorAll('[data-mode]').forEach(b=>{
    if(b.dataset.mode===fluxoMode) b.classList.add('on');
    b.onclick=()=>{ fluxoMode=b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('on',x.dataset.mode===fluxoMode)); drawFluxo(); };
  });
  await loadFluxo();
}
async function loadFluxo(){
  try{
    const [acc,tx,rec,pag]=await Promise.all([
      scopeQ(db.from('financial_accounts').select('saldo_inicial,company_id')),
      scopeQ(db.from('bank_transactions').select('tipo,valor,data,descricao,company_id')),
      scopeQ(db.from('vw_contas_receber').select('saldo,situacao,vencimento,descricao,company_id')),
      scopeQ(db.from('vw_contas_pagar').select('saldo,situacao,vencimento,descricao,company_id')),
    ]);
    for(const r of [acc,tx,rec,pag]) if(r.error) throw r.error;
    const base=(acc.data||[]).reduce((s,x)=>s+Number(x.saldo_inicial||0),0);
    const realE={},realS={},prevE={},prevS={},movsReal=[],movsPrev=[];
    (tx.data||[]).forEach(t=>{
      const k=ymOf(t.data);
      if(t.tipo==='entrada'){ realE[k]=(realE[k]||0)+Number(t.valor); movsReal.push({ym:k,data:t.data,descricao:t.descricao||'Recebimento',valor:Number(t.valor),tipo:'entrada',origem:'realizado'}); }
      else if(t.tipo==='saida'){ realS[k]=(realS[k]||0)+Number(t.valor); movsReal.push({ym:k,data:t.data,descricao:t.descricao||'Pagamento',valor:Number(t.valor),tipo:'saida',origem:'realizado'}); }
    });
    const aberto=s=>!['recebido','pago','cancelado'].includes(s);
    (rec.data||[]).forEach(r=>{ if(aberto(r.situacao)&&Number(r.saldo)>0){ const k=ymOf(r.vencimento); prevE[k]=(prevE[k]||0)+Number(r.saldo); movsPrev.push({ym:k,data:r.vencimento,descricao:r.descricao||'A receber',valor:Number(r.saldo),tipo:'entrada',origem:'previsto'}); } });
    (pag.data||[]).forEach(p=>{ if(aberto(p.situacao)&&Number(p.saldo)>0){ const k=ymOf(p.vencimento); prevS[k]=(prevS[k]||0)+Number(p.saldo); movsPrev.push({ym:k,data:p.vencimento,descricao:p.descricao||'A pagar',valor:Number(p.saldo),tipo:'saida',origem:'previsto'}); } });
    fluxoData={base,realE,realS,prevE,prevS,movsReal,movsPrev};
    drawFluxo();
  }catch(err){
    $('fluxoArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}
function fluxoDetail(ym,movs){
  const list=movs.filter(m=>m.ym===ym).sort((a,b)=>a.data.localeCompare(b.data));
  if(!list.length) return '<div class="empty" style="padding:16px">Sem movimentos neste mês.</div>';
  return `<table style="margin:0"><tbody>${list.map(m=>`<tr class="inst-row">
    <td style="padding-left:38px;width:110px">${fmtDate(m.data)}</td>
    <td>${esc(m.descricao)}${m.origem==='previsto'?' <span class="pill st-a_vencer" style="margin-left:4px">previsto</span>':''}</td>
    <td class="r" style="width:150px;color:${m.tipo==='entrada'?'var(--green)':'var(--red)'}">${m.tipo==='entrada'?'+ ':'− '}${money(m.valor)}</td>
  </tr>`).join('')}</tbody></table>`;
}
function drawFluxo(){
  if(!fluxoData) return;
  const {base,realE,realS,prevE,prevS,movsReal,movsPrev}=fluxoData;
  const E={},S={};
  const add=(dst,src)=>{ for(const k in src) dst[k]=(dst[k]||0)+src[k]; };
  let detail;
  if(fluxoMode==='realizado'){ add(E,realE); add(S,realS); detail=movsReal; }
  else if(fluxoMode==='previsto'){ add(E,prevE); add(S,prevS); detail=movsPrev; }
  else { add(E,realE); add(E,prevE); add(S,realS); add(S,prevS); detail=[...movsReal,...movsPrev]; }

  const months=monthsRange([...new Set([...Object.keys(E),...Object.keys(S)])]);
  if(!months.length){ $('fluxoArea').innerHTML='<div class="panel"><div class="empty">Sem movimentos para exibir neste modo.</div></div>'; return; }

  let running=base, totE=0, totS=0;
  const linhas=months.map(ym=>{
    const e=E[ym]||0, s=S[ym]||0; totE+=e; totS+=s;
    const ini=running, fim=running+e-s; running=fim;
    return {ym,e,s,ini,fim};
  });
  const maxBar=Math.max(1,...linhas.map(l=>Math.max(l.e,l.s)));

  const kpis=`<div class="cards3">
    <div class="kpi"><div class="lbl"><span class="dot g"></span>Entradas no período</div><div class="val pos">${money(totE)}</div></div>
    <div class="kpi"><div class="lbl"><span class="dot r"></span>Saídas no período</div><div class="val neg">${money(totS)}</div></div>
    <div class="kpi"><div class="lbl"><span class="dot t"></span>Resultado do período</div><div class="val ${totE-totS<0?'neg':'pos'}">${money(totE-totS)}</div></div>
  </div>`;

  const chart=`<div class="panel" style="margin-bottom:16px"><h3><span class="dot t"></span>Entradas x Saídas por mês</h3>
    <div class="legend"><span><span class="dot g"></span>Entradas</span><span><span class="dot r"></span>Saídas</span></div>
    <div class="chart">${linhas.map(l=>`<div class="cbar-group">
      <div class="cbars">
        <div class="cbar e" style="height:${Math.round(l.e/maxBar*130)}px" title="Entradas ${money(l.e)}"></div>
        <div class="cbar s" style="height:${Math.round(l.s/maxBar*130)}px" title="Saídas ${money(l.s)}"></div>
      </div><div class="cbar-lbl">${ymLabel(l.ym)}</div></div>`).join('')}</div></div>`;

  const rowsHtml=linhas.map(l=>{
    const open=openFluxo.has(l.ym);
    const main=`<tr class="title-row" data-ym="${l.ym}">
      <td><span class="caret ${open?'open':''}">▶</span>${ymLabel(l.ym)}</td>
      <td class="r">${money(l.ini)}</td>
      <td class="r" style="color:var(--green)">${l.e?money(l.e):'—'}</td>
      <td class="r" style="color:var(--red)">${l.s?money(l.s):'—'}</td>
      <td class="r" style="font-weight:600;color:${l.fim<0?'var(--red)':'var(--ink)'}">${money(l.fim)}</td></tr>`;
    const det=open?`<tr><td colspan="5" style="padding:0;background:#f8fafb">${fluxoDetail(l.ym,detail)}</td></tr>`:'';
    return main+det;
  }).join('');

  const tabela=`<div class="panel"><h3><span class="dot t"></span>Fluxo mensal <span style="font-weight:400;color:var(--muted);font-size:12px">— clique no mês para ver os dias</span></h3>
    <table><thead><tr><th>Mês</th><th class="r">Saldo inicial</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Saldo final</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`;

  $('fluxoArea').innerHTML=kpis+chart+tabela;
  $('fluxoArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const ym=tr.dataset.ym; openFluxo.has(ym)?openFluxo.delete(ym):openFluxo.add(ym); drawFluxo();
  });
}

/* ===================== CENTRAL DE PENDÊNCIAS ===================== */
const PRIO={baixa:'Baixa',media:'Média',alta:'Alta',critica:'Crítica'};
const PRIO_ORDER={critica:0,alta:1,media:2,baixa:3};
const PSTATUS={aberta:'Aberta',em_andamento:'Em andamento',aguardando_cliente:'Aguardando cliente',aguardando_documento:'Aguardando documento',resolvida:'Resolvida',cancelada:'Cancelada'};
let pendCache={rows:[],tipos:[],profiles:[]};
let pendFilters={tipo:'',prioridade:'',status:'',resp:''};

async function renderPendencias(){
  $('main').innerHTML=`<div class="page-h"><h1>Pendências</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnGerar">Gerar automáticas</button><button class="btn" id="btnNovaPend">+ Nova pendência</button></div></div>
    <div class="updated">Pendências manuais e automáticas (contas vencidas, tarefas atrasadas). As automáticas se resolvem sozinhas quando a origem é resolvida.</div>
    <div id="pendFilters"></div>
    <div id="pendArea"><div class="loading">Carregando…</div></div>`;
  $('btnGerar').onclick=gerarPendenciasAuto;
  $('btnNovaPend').onclick=()=>openPendForm(null);
  await loadPend();
}
async function gerarPendenciasAuto(){
  $('btnGerar').disabled=true; $('btnGerar').textContent='Gerando…';
  const { data,error }=await db.rpc('gerar_pendencias_automaticas', companyId?{p_company:companyId}:{});
  $('btnGerar').disabled=false; $('btnGerar').textContent='Gerar automáticas';
  if(error){ toast('Erro: '+error.message,'err'); return; }
  toast((data||0)+' pendência(s) nova(s) gerada(s).');
  loadPend();
}
async function loadPend(){
  try{
    const [pend,tipos,profs]=await Promise.all([
      scopeQ(db.from('pending_items').select('*')),
      db.from('pending_item_types').select('key,nome'),
      db.from('profiles').select('id,nome,email'),
    ]);
    if(pend.error) throw pend.error;
    pendCache={rows:pend.data||[],tipos:tipos.data||[],profiles:profs.data||[]};
    renderPendFilters(); drawPend();
  }catch(err){
    $('pendArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}
function profName(id){ const p=pendCache.profiles.find(x=>x.id===id); return p?(p.nome||p.email):'—'; }
function tipoName(k){ const t=pendCache.tipos.find(x=>x.key===k); return t?t.nome:k; }
function renderPendFilters(){
  $('pendFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Tipo</label><select id="pfTipo"><option value="">Todos</option>${pendCache.tipos.map(t=>`<option value="${t.key}" ${pendFilters.tipo===t.key?'selected':''}>${esc(t.nome)}</option>`).join('')}</select></div>
    <div class="fg"><label>Prioridade</label><select id="pfPrio"><option value="">Todas</option>${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${pendFilters.prioridade===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Status</label><select id="pfSt"><option value="">Todos</option>${Object.entries(PSTATUS).map(([k,v])=>`<option value="${k}" ${pendFilters.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Responsável</label><select id="pfResp"><option value="">Todos</option>${pendCache.profiles.map(p=>`<option value="${p.id}" ${pendFilters.resp===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
  </div>`;
  $('pfTipo').onchange=e=>{pendFilters.tipo=e.target.value;drawPend();};
  $('pfPrio').onchange=e=>{pendFilters.prioridade=e.target.value;drawPend();};
  $('pfSt').onchange=e=>{pendFilters.status=e.target.value;drawPend();};
  $('pfResp').onchange=e=>{pendFilters.resp=e.target.value;drawPend();};
}
function drawPend(){
  let rows=pendCache.rows.slice();
  if(pendFilters.tipo) rows=rows.filter(r=>r.tipo===pendFilters.tipo);
  if(pendFilters.prioridade) rows=rows.filter(r=>r.prioridade===pendFilters.prioridade);
  if(pendFilters.status) rows=rows.filter(r=>r.status===pendFilters.status);
  if(pendFilters.resp) rows=rows.filter(r=>r.assigned_user_id===pendFilters.resp);
  rows.sort((a,b)=>(PRIO_ORDER[a.prioridade]-PRIO_ORDER[b.prioridade]) || ((a.prazo||'9999').localeCompare(b.prazo||'9999')));
  if(!rows.length){ $('pendArea').innerHTML='<div class="panel"><div class="empty">Nenhuma pendência. Clique em “Gerar automáticas” ou “+ Nova pendência”.</div></div>'; return; }
  const showCo=!companyId;
  const stOpts=r=>Object.entries(PSTATUS).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''}>${v}</option>`).join('');
  const body=rows.map((r,i)=>`<tr>
    <td><span class="pill pr-${r.prioridade}">${PRIO[r.prioridade]}</span></td>
    <td>${esc(tipoName(r.tipo))}</td>
    <td><b>${esc(r.titulo)}</b>${r.descricao?`<br><span style="font-size:12px;color:var(--muted)">${esc(r.descricao)}</span>`:''}${r.origem==='automatica'?' <span class="pill ps-aberta" style="font-size:9px">auto</span>':''}</td>
    ${showCo?`<td>${esc(coName(r.company_id))}</td>`:''}
    <td>${esc(profName(r.assigned_user_id))}</td>
    <td>${r.prazo?fmtDate(r.prazo):'—'}</td>
    <td><select class="stsel ps-${r.status}" data-st="${r.id}">${stOpts(r)}</select></td>
    <td><div class="act"><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('pendArea').innerHTML=`<div class="panel"><table><thead><tr>
    <th>Prioridade</th><th>Tipo</th><th>Pendência</th>${showCo?'<th>Empresa</th>':''}<th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  $('pendArea').querySelectorAll('[data-st]').forEach(s=>s.onchange=()=>updatePendStatus(s.dataset.st,s.value));
  $('pendArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openPendForm(rows[+b.dataset.edit]));
  $('pendArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delPend(rows[+b.dataset.del]));
}
async function updatePendStatus(id,status){
  const patch={status}; if(status==='resolvida') patch.resolved_at=new Date().toISOString();
  const { error }=await db.from('pending_items').update(patch).eq('id',id);
  if(error){ toast('Erro ao atualizar status.','err'); return; }
  toast('Status atualizado.'); loadPend();
}
function openPendForm(rec){
  const creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field"><label>Empresa *</label><select id="peCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} pendência</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      ${coField}
      <div class="field"><label>Tipo *</label><select id="peTipo">${pendCache.tipos.map(t=>`<option value="${t.key}" ${rec&&rec.tipo===t.key?'selected':(!rec&&t.key==='outros'?'selected':'')}>${esc(t.nome)}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/3"><label>Título *</label><input id="peTitulo" value="${esc(rec?rec.titulo:'')}"></div>
      <div class="field" style="grid-column:1/3"><label>Descrição</label><textarea id="peDesc" rows="2">${esc(rec?rec.descricao:'')}</textarea></div>
      <div class="field"><label>Prioridade</label><select id="pePrio">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${(rec?rec.prioridade:'media')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Responsável</label><select id="peResp"><option value="">—</option>${pendCache.profiles.map(p=>`<option value="${p.id}" ${rec&&rec.assigned_user_id===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
      <div class="field"><label>Prazo</label><input id="pePrazo" type="date" value="${rec&&rec.prazo?rec.prazo:''}"></div>
      <div class="field"><label>Status</label><select id="peStatus">${Object.entries(PSTATUS).map(([k,v])=>`<option value="${k}" ${(rec?rec.status:'aberta')===k?'selected':''}>${v}</option>`).join('')}</select></div>
    </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const titulo=$('peTitulo').value.trim();
    if(!titulo){ toast('Informe o título.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ tipo:$('peTipo').value, titulo, descricao:$('peDesc').value||null,
      prioridade:$('pePrio').value, assigned_user_id:$('peResp').value||null,
      prazo:$('pePrazo').value||null, status:$('peStatus').value };
    let res;
    if(creating){ payload.company_id=$('peCo').value; payload.origem='manual'; res=await db.from('pending_items').insert(payload); }
    else res=await db.from('pending_items').update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast('Pendência '+(creating?'criada!':'atualizada!')); loadPend();
  };
}
async function delPend(rec){
  const ok=await confirmModal({titulo:'Excluir pendência',texto:`Excluir “${rec.titulo}”?`,ok:'Excluir',perigo:true});
  if(!ok) return;
  const { error }=await db.from('pending_items').delete().eq('id',rec.id);
  if(error){ toast('Erro ao excluir.','err'); return; }
  toast('Excluída.'); loadPend();
}

/* ===================== TAREFAS ===================== */
const TSTATUS={a_fazer:'A fazer',em_andamento:'Em andamento',aguardando:'Aguardando',concluida:'Concluída',cancelada:'Cancelada'};
const REC={nenhuma:'Não repete',diaria:'Diária',semanal:'Semanal',quinzenal:'Quinzenal',mensal:'Mensal',trimestral:'Trimestral',anual:'Anual'};
let tarCache={tasks:[],chk:{},profiles:[],templates:[]};
let tarFilters={status:'',prioridade:'',resp:''};
const openTasks=new Set();
function addRec(d,rec){ const b=new Date((d||todayStr())+'T00:00:00');
  if(rec==='diaria')b.setDate(b.getDate()+1); else if(rec==='semanal')b.setDate(b.getDate()+7);
  else if(rec==='quinzenal')b.setDate(b.getDate()+15); else if(rec==='mensal')b.setMonth(b.getMonth()+1);
  else if(rec==='trimestral')b.setMonth(b.getMonth()+3); else if(rec==='anual')b.setMonth(b.getMonth()+12);
  return b.toISOString().slice(0,10); }

async function renderTarefas(){
  $('main').innerHTML=`<div class="page-h"><h1>Tarefas</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovaTar">+ Nova tarefa</button></div>
    <div class="updated">Com checklist e recorrência. Ao concluir uma tarefa recorrente, a próxima é criada automaticamente.</div>
    <div id="tarFilters"></div><div id="tarArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaTar').onclick=()=>openTarForm(null);
  await loadTarefas();
}
async function loadTarefas(){
  try{
    const [tks,chk,profs,tpls]=await Promise.all([
      scopeQ(db.from('tasks').select('*')),
      scopeQ(db.from('task_checklists').select('*')),
      db.from('profiles').select('id,nome,email'),
      db.from('task_templates').select('*'),
    ]);
    if(tks.error) throw tks.error; if(chk.error) throw chk.error;
    const byT={}; (chk.data||[]).forEach(c=>{(byT[c.task_id]=byT[c.task_id]||[]).push(c);});
    Object.values(byT).forEach(a=>a.sort((x,y)=>x.ordem-y.ordem));
    tarCache={tasks:tks.data||[],chk:byT,profiles:profs.data||[],templates:tpls.data||[]};
    renderTarFilters(); drawTarefas();
  }catch(err){ $('tarArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
function tProf(id){ const p=tarCache.profiles.find(x=>x.id===id); return p?(p.nome||p.email):'—'; }
function renderTarFilters(){
  $('tarFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Status</label><select id="tfSt"><option value="">Todos</option>${Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${tarFilters.status===k?'selected':''}>${v}</option>`).join('')}<option value="atrasada" ${tarFilters.status==='atrasada'?'selected':''}>Atrasadas</option></select></div>
    <div class="fg"><label>Prioridade</label><select id="tfPr"><option value="">Todas</option>${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${tarFilters.prioridade===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Responsável</label><select id="tfRe"><option value="">Todos</option>${tarCache.profiles.map(p=>`<option value="${p.id}" ${tarFilters.resp===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
  </div>`;
  $('tfSt').onchange=e=>{tarFilters.status=e.target.value;drawTarefas();};
  $('tfPr').onchange=e=>{tarFilters.prioridade=e.target.value;drawTarefas();};
  $('tfRe').onchange=e=>{tarFilters.resp=e.target.value;drawTarefas();};
}
const isAtrasada=t=>t.prazo && t.prazo<todayStr() && !['concluida','cancelada'].includes(t.status);
function drawTarefas(){
  let rows=tarCache.tasks.slice();
  if(tarFilters.status==='atrasada') rows=rows.filter(isAtrasada);
  else if(tarFilters.status) rows=rows.filter(t=>t.status===tarFilters.status);
  if(tarFilters.prioridade) rows=rows.filter(t=>t.prioridade===tarFilters.prioridade);
  if(tarFilters.resp) rows=rows.filter(t=>t.assigned_user_id===tarFilters.resp);
  rows.sort((a,b)=>(PRIO_ORDER[a.prioridade]-PRIO_ORDER[b.prioridade])||((a.prazo||'9999').localeCompare(b.prazo||'9999')));
  if(!rows.length){ $('tarArea').innerHTML='<div class="panel"><div class="empty">Nenhuma tarefa. Clique em “+ Nova tarefa”.</div></div>'; return; }
  const showCo=!companyId;
  const stOpts=t=>Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('');
  const body=rows.map((t,i)=>{
    const open=openTasks.has(t.id);
    const items=tarCache.chk[t.id]||[];
    const done=items.filter(c=>c.done).length;
    const prog=items.length?`${done}/${items.length}`:'—';
    const atras=isAtrasada(t)?' <span class="pill st-vencido">atrasada</span>':'';
    const rec=t.recorrencia&&t.recorrencia!=='nenhuma'?` <span class="pill ps-em_andamento" style="font-size:9px">${REC[t.recorrencia]}</span>`:'';
    const main=`<tr class="title-row" data-i="${i}">
      <td><span class="caret ${open?'open':''}">▶</span><span class="pill pr-${t.prioridade}">${PRIO[t.prioridade]}</span></td>
      <td><b>${esc(t.titulo)}</b>${rec}${t.categoria?`<br><span style="font-size:12px;color:var(--muted)">${esc(t.categoria)}</span>`:''}</td>
      ${showCo?`<td>${esc(coName(t.company_id))}</td>`:''}
      <td>${esc(tProf(t.assigned_user_id))}</td>
      <td>${t.prazo?fmtDate(t.prazo):'—'}${atras}</td>
      <td>${prog}</td>
      <td><select class="stsel" data-st="${t.id}">${stOpts(t)}</select></td>
      <td><div class="act"><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`;
    let det='';
    if(open){
      const chkHtml=items.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0">
        <input type="checkbox" data-chk="${c.id}" ${c.done?'checked':''} style="width:16px;height:16px">
        <span style="flex:1;font-size:13px;${c.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(c.descricao)}</span>
        <button class="lnk del" data-chkdel="${c.id}" style="padding:2px 8px">×</button></div>`).join('') || '<div style="color:var(--muted);font-size:13px;padding:4px 0">Sem itens no checklist.</div>';
      det=`<tr><td colspan="${showCo?8:7}" style="background:#f8fafb">
        <div style="padding:6px 8px 12px 38px">
          <div style="font-size:12px;font-weight:600;color:var(--ink);margin-bottom:6px">Checklist</div>
          ${chkHtml}
          <div style="display:flex;gap:8px;margin-top:8px;max-width:460px">
            <input id="chkNew_${t.id}" placeholder="Novo item do checklist" style="flex:1;padding:7px 10px;font-size:13px">
            <button class="mini" data-chkadd="${t.id}">Adicionar</button>
          </div>
          ${t.descricao?`<div style="margin-top:10px;font-size:12.5px;color:var(--muted)"><b>Descrição:</b> ${esc(t.descricao)}</div>`:''}
          ${t.completed_at?`<div style="margin-top:6px;font-size:12px;color:var(--green)">Concluída em ${fmtDate(t.completed_at.slice(0,10))} por ${esc(tProf(t.completed_by))}</div>`:''}
        </div></td></tr>`;
    }
    return main+det;
  }).join('');
  $('tarArea').innerHTML=`<div class="panel"><table><thead><tr>
    <th>Prioridade</th><th>Tarefa</th>${showCo?'<th>Empresa</th>':''}<th>Responsável</th><th>Prazo</th><th>Checklist</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  $('tarArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=e=>{
    if(e.target.closest('select,button')) return;
    const t=rows[+tr.dataset.i]; openTasks.has(t.id)?openTasks.delete(t.id):openTasks.add(t.id); drawTarefas();
  });
  $('tarArea').querySelectorAll('[data-st]').forEach(s=>s.onclick=e=>e.stopPropagation());
  $('tarArea').querySelectorAll('[data-st]').forEach(s=>s.onchange=()=>changeTaskStatus(s.dataset.st,s.value));
  $('tarArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openTarForm(rows[+b.dataset.edit]);});
  $('tarArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();delTarefa(rows[+b.dataset.del]);});
  $('tarArea').querySelectorAll('[data-chk]').forEach(c=>c.onchange=()=>toggleChk(c.dataset.chk,c.checked));
  $('tarArea').querySelectorAll('[data-chkdel]').forEach(b=>b.onclick=()=>delChk(b.dataset.chkdel));
  $('tarArea').querySelectorAll('[data-chkadd]').forEach(b=>b.onclick=()=>addChk(b.dataset.chkadd));
}
async function changeTaskStatus(id,status){
  const t=tarCache.tasks.find(x=>x.id===id); if(!t) return;
  const patch={status};
  if(status==='concluida'){ patch.completed_at=new Date().toISOString(); patch.completed_by=userId; }
  const { error }=await db.from('tasks').update(patch).eq('id',id);
  if(error){ toast('Erro ao atualizar.','err'); return; }
  if(status==='concluida' && t.recorrencia && t.recorrencia!=='nenhuma') await gerarProximaTarefa(t);
  toast('Status atualizado.'); loadTarefas();
}
async function gerarProximaTarefa(t){
  const novo={ company_id:t.company_id, titulo:t.titulo, descricao:t.descricao, categoria:t.categoria,
    assigned_user_id:t.assigned_user_id, prioridade:t.prioridade, recorrencia:t.recorrencia,
    recurrence_parent_id:t.recurrence_parent_id||t.id, status:'a_fazer',
    data_inicial: t.data_inicial?addRec(t.data_inicial,t.recorrencia):null,
    prazo: t.prazo?addRec(t.prazo,t.recorrencia):null };
  const { data,error }=await db.from('tasks').insert(novo).select('id').single();
  if(error||!data) return;
  const items=tarCache.chk[t.id]||[];
  if(items.length){
    const copies=items.map(c=>({task_id:data.id,company_id:t.company_id,descricao:c.descricao,done:false,ordem:c.ordem}));
    await db.from('task_checklists').insert(copies);
  }
  toast('Próxima tarefa recorrente criada.');
}
async function toggleChk(id,done){ const { error }=await db.from('task_checklists').update({done}).eq('id',id); if(error){toast('Erro.','err');return;} loadTarefas(); }
async function delChk(id){ const { error }=await db.from('task_checklists').delete().eq('id',id); if(error){toast('Erro.','err');return;} loadTarefas(); }
async function addChk(taskId){
  const inp=$('chkNew_'+taskId); const desc=(inp&&inp.value||'').trim(); if(!desc){toast('Digite o item.','err');return;}
  const t=tarCache.tasks.find(x=>x.id===taskId); const ordem=(tarCache.chk[taskId]||[]).length;
  const { error }=await db.from('task_checklists').insert({task_id:taskId,company_id:t.company_id,descricao:desc,ordem});
  if(error){toast('Erro ao adicionar.','err');return;} loadTarefas();
}
function openTarForm(rec){
  const creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field"><label>Empresa *</label><select id="taCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  const tplField=creating?`<div class="field" style="grid-column:1/3"><label>Carregar modelo de checklist (opcional)</label><select id="taTpl"><option value="">— nenhum —</option>${tarCache.templates.map(t=>`<option value="${t.id}">${esc(t.nome)} (${(t.itens||[]).length} itens)</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} tarefa</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      ${coField}
      <div class="field"><label>Categoria</label><input id="taCat" value="${esc(rec?rec.categoria:'')}" placeholder="ex: Financeiro"></div>
      <div class="field" style="grid-column:1/3"><label>Título *</label><input id="taTit" value="${esc(rec?rec.titulo:'')}"></div>
      <div class="field" style="grid-column:1/3"><label>Descrição</label><textarea id="taDesc" rows="2">${esc(rec?rec.descricao:'')}</textarea></div>
      <div class="field"><label>Responsável</label><select id="taResp"><option value="">—</option>${tarCache.profiles.map(p=>`<option value="${p.id}" ${rec&&rec.assigned_user_id===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
      <div class="field"><label>Prioridade</label><select id="taPrio">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${(rec?rec.prioridade:'media')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Data inicial</label><input id="taIni" type="date" value="${rec&&rec.data_inicial?rec.data_inicial:''}"></div>
      <div class="field"><label>Prazo</label><input id="taPrazo" type="date" value="${rec&&rec.prazo?rec.prazo:''}"></div>
      <div class="field"><label>Recorrência</label><select id="taRec">${Object.entries(REC).map(([k,v])=>`<option value="${k}" ${(rec?rec.recorrencia:'nenhuma')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select id="taSt">${Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${(rec?rec.status:'a_fazer')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      ${tplField}
    </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const titulo=$('taTit').value.trim(); if(!titulo){toast('Informe o título.','err');return;}
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ titulo, descricao:$('taDesc').value||null, categoria:$('taCat').value||null,
      assigned_user_id:$('taResp').value||null, prioridade:$('taPrio').value,
      data_inicial:$('taIni').value||null, prazo:$('taPrazo').value||null,
      recorrencia:$('taRec').value, status:$('taSt').value };
    let res, taskId;
    if(creating){ payload.company_id=$('taCo').value; res=await db.from('tasks').insert(payload).select('id').single(); taskId=res.data&&res.data.id; }
    else { res=await db.from('tasks').update(payload).eq('id',rec.id); taskId=rec.id; }
    if(res.error){ $('mSave').disabled=false; $('mSave').textContent='Salvar'; toast('Erro: '+res.error.message,'err'); return; }
    // modelo de checklist
    if(creating){ const tplId=$('taTpl').value; if(tplId){ const tpl=tarCache.templates.find(t=>t.id===tplId);
      if(tpl && (tpl.itens||[]).length){ const items=tpl.itens.map((d,idx)=>({task_id:taskId,company_id:payload.company_id,descricao:d,ordem:idx})); await db.from('task_checklists').insert(items); } } }
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    closeModal(); toast('Tarefa '+(creating?'criada!':'atualizada!')); loadTarefas();
  };
}
async function delTarefa(rec){
  const ok=await confirmModal({titulo:'Excluir tarefa',texto:`Excluir “${rec.titulo}”? O checklist também será removido.`,ok:'Excluir',perigo:true});
  if(!ok) return;
  const { error }=await db.from('tasks').delete().eq('id',rec.id);
  if(error){ toast('Erro ao excluir.','err'); return; }
  toast('Excluída.'); loadTarefas();
}

/* ===================== DOCUMENTOS ===================== */
const DSTATUS={pendente:'Pendente',solicitado:'Solicitado',recebido:'Recebido',conferido:'Conferido',rejeitado:'Rejeitado'};
const DSTCLS={pendente:'ps-aberta',solicitado:'ps-aguardando_cliente',recebido:'ps-em_andamento',conferido:'ps-resolvida',rejeitado:'ps-cancelada'};
let docCache={docs:[],reqs:[],profiles:[]};
let docFilters={status:'',busca:''};

async function uploadDoc(companyId,file){
  const safe=file.name.replace(/[^\w.\-]/g,'_');
  const path=`${companyId}/${Date.now()}_${safe}`;
  const { error }=await db.storage.from('documentos').upload(path,file);
  if(error) throw error; return path;
}
async function abrirDoc(path){
  const { data,error }=await db.storage.from('documentos').createSignedUrl(path,120);
  if(error){ toast('Erro ao gerar link.','err'); return; }
  window.open(data.signedUrl,'_blank');
}

async function renderDocumentos(){
  $('main').innerHTML=`<div class="page-h"><h1>Documentos</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnSolic">Solicitar documento</button><button class="btn" id="btnEnviar">+ Enviar documento</button></div></div>
    <div class="updated">Arquivos guardados com segurança (bucket privado, isolados por empresa).</div>
    <div id="docReqs"></div><div id="docFilters"></div><div id="docArea"><div class="loading">Carregando…</div></div>`;
  $('btnEnviar').onclick=()=>openDocForm(null);
  $('btnSolic').onclick=openDocSolicitar;
  await loadDocs();
}
async function loadDocs(){
  try{
    const [docs,reqs,profs]=await Promise.all([
      scopeQ(db.from('documents').select('*, customers(razao_social,nome_fantasia), suppliers(razao_social,nome_fantasia)')).order('created_at',{ascending:false}),
      scopeQ(db.from('document_requests').select('*')).order('created_at',{ascending:false}),
      db.from('profiles').select('id,nome,email'),
    ]);
    if(docs.error) throw docs.error;
    docCache={docs:docs.data||[],reqs:reqs.data||[],profiles:profs.data||[]};
    drawDocReqs(); renderDocFilters(); drawDocs();
  }catch(err){ $('docArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
function dProf(id){ const p=docCache.profiles.find(x=>x.id===id); return p?(p.nome||p.email):'—'; }
function drawDocReqs(){
  const reqs=docCache.reqs.filter(r=>r.status==='solicitado');
  if(!reqs.length){ $('docReqs').innerHTML=''; return; }
  $('docReqs').innerHTML=`<div class="panel" style="margin-bottom:16px"><h3><span class="dot a"></span>Solicitações em aberto (${reqs.length})</h3>
    <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Competência</th><th>Responsável</th><th>Prazo</th><th></th></tr></thead>
    <tbody>${reqs.map((r,i)=>`<tr><td><b>${esc(r.descricao)}</b></td><td>${esc(r.tipo_documento||'—')}</td>
      <td>${r.competencia?fmtDate(r.competencia):'—'}</td><td>${esc(dProf(r.assigned_user_id))}</td><td>${r.prazo?fmtDate(r.prazo):'—'}</td>
      <td><div class="act"><button class="lnk" data-anexar="${i}">Anexar</button><button class="lnk" data-reqok="${i}">Marcar recebido</button></div></td></tr>`).join('')}</tbody></table></div>`;
  $('docReqs').querySelectorAll('[data-anexar]').forEach(b=>b.onclick=()=>openDocForm(null, reqs[+b.dataset.anexar]));
  $('docReqs').querySelectorAll('[data-reqok]').forEach(b=>b.onclick=()=>marcarReqRecebido(reqs[+b.dataset.reqok]));
}
async function marcarReqRecebido(req){
  const { error }=await db.from('document_requests').update({status:'recebido'}).eq('id',req.id);
  if(error){ toast('Erro.','err'); return; } toast('Solicitação marcada como recebida.'); loadDocs();
}
function renderDocFilters(){
  $('docFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Status</label><select id="dfSt"><option value="">Todos</option>${Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${docFilters.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Buscar</label><input id="dfB" placeholder="nome do documento" value="${esc(docFilters.busca)}"></div>
  </div>`;
  $('dfSt').onchange=e=>{docFilters.status=e.target.value;drawDocs();};
  $('dfB').oninput=e=>{docFilters.busca=e.target.value;drawDocs();};
}
function drawDocs(){
  let rows=docCache.docs.slice();
  if(docFilters.status) rows=rows.filter(d=>d.status===docFilters.status);
  if(docFilters.busca) rows=rows.filter(d=>(d.nome||'').toLowerCase().includes(docFilters.busca.toLowerCase()));
  if(!rows.length){ $('docArea').innerHTML='<div class="panel"><div class="empty">Nenhum documento. Clique em “+ Enviar documento”.</div></div>'; return; }
  const showCo=!companyId;
  const vinc=d=>{ const c=d.customers&&(d.customers.nome_fantasia||d.customers.razao_social); const s=d.suppliers&&(d.suppliers.nome_fantasia||d.suppliers.razao_social); return c?('Cliente: '+c):(s?('Forn.: '+s):'—'); };
  const stOpts=d=>Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${d.status===k?'selected':''}>${v}</option>`).join('');
  const body=rows.map((d,i)=>`<tr>
    <td><b>${esc(d.nome)}</b>${d.tipo?`<br><span style="font-size:12px;color:var(--muted)">${esc(d.tipo)}</span>`:''}</td>
    ${showCo?`<td>${esc(coName(d.company_id))}</td>`:''}
    <td>${esc(vinc(d))}</td>
    <td>${d.competencia?fmtDate(d.competencia):'—'}</td>
    <td><select class="stsel ${DSTCLS[d.status]}" data-st="${d.id}">${stOpts(d)}</select></td>
    <td><div class="act">${d.storage_path?`<button class="lnk" data-open="${i}">Baixar</button>`:''}<button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('docArea').innerHTML=`<div class="panel"><table><thead><tr><th>Documento</th>${showCo?'<th>Empresa</th>':''}<th>Vínculo</th><th>Competência</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('docArea').querySelectorAll('[data-st]').forEach(s=>s.onchange=()=>updateDocStatus(s.dataset.st,s.value));
  $('docArea').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>abrirDoc(rows[+b.dataset.open].storage_path));
  $('docArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openDocForm(rows[+b.dataset.edit]));
  $('docArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delDoc(rows[+b.dataset.del]));
}
async function updateDocStatus(id,status){
  const { error }=await db.from('documents').update({status}).eq('id',id);
  if(error){ toast('Erro.','err'); return; } toast('Status atualizado.'); loadDocs();
}
async function fillDocSelects(co){
  if(!co) return;
  const [cli,forn,acc,cat]=await Promise.all([
    db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
    db.from('categories').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl,sel)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}" ${sel===x.id?'selected':''}>${esc(lbl(x))}</option>`).join('');
  return {cli,forn,acc,cat,opt};
}
async function openDocForm(rec, req){
  const creating=!rec;
  const defaultCo=(req&&req.company_id)||(rec&&rec.company_id)||companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Enviar':'Editar'} documento</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      <div class="field"><label>Empresa *</label><select id="doCo" ${creating?'':'disabled'}>${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo</label><input id="doTipo" value="${esc(rec?rec.tipo:(req?req.tipo_documento||'':''))}" placeholder="NF, contrato, boleto…"></div>
      <div class="field" style="grid-column:1/3"><label>Nome do documento *</label><input id="doNome" value="${esc(rec?rec.nome:(req?req.descricao:''))}" placeholder="ex: NF 123 - Fornecedor X"></div>
      ${creating?`<div class="field" style="grid-column:1/3"><label>Arquivo</label><input id="doFile" type="file"><div class="hint">Opcional. Sem arquivo, o documento fica como pendente/solicitado.</div></div>`:''}
      <div class="field"><label>Data</label><input id="doData" type="date" value="${rec&&rec.data?rec.data:''}"></div>
      <div class="field"><label>Competência</label><input id="doComp" type="date" value="${rec&&rec.competencia?rec.competencia:(req&&req.competencia?req.competencia:'')}"></div>
      <div class="field"><label>Cliente</label><select id="doCli"><option value="">—</option></select></div>
      <div class="field"><label>Fornecedor</label><select id="doForn"><option value="">—</option></select></div>
      <div class="field"><label>Conta financeira</label><select id="doAcc"><option value="">—</option></select></div>
      <div class="field"><label>Categoria</label><select id="doCat"><option value="">—</option></select></div>
      <div class="field"><label>Status</label><select id="doSt">${Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${(rec?rec.status:(req?'recebido':'recebido'))===k?'selected':''}>${v}</option>`).join('')}</select></div>
    </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  async function loadSel(co){ const s=await fillDocSelects(co); if(!s)return;
    $('doCli').innerHTML=s.opt(s.cli,x=>x.nome_fantasia||x.razao_social, rec?rec.customer_id:null);
    $('doForn').innerHTML=s.opt(s.forn,x=>x.nome_fantasia||x.razao_social, rec?rec.supplier_id:null);
    $('doAcc').innerHTML=s.opt(s.acc,x=>x.nome, rec?rec.financial_account_id:null);
    $('doCat').innerHTML=s.opt(s.cat,x=>x.nome, rec?rec.categoria_id:null);
  }
  await loadSel(defaultCo);
  if(creating) $('doCo').onchange=()=>loadSel($('doCo').value);
  $('mSave').onclick=async ()=>{
    const nome=$('doNome').value.trim(); if(!nome){toast('Informe o nome.','err');return;}
    const co=creating?$('doCo').value:rec.company_id;
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    try{
      let storage_path=rec?rec.storage_path:null;
      if(creating){ const f=$('doFile').files[0]; if(f) storage_path=await uploadDoc(co,f); }
      const payload={ nome, tipo:$('doTipo').value||null, data:$('doData').value||null, competencia:$('doComp').value||null,
        customer_id:$('doCli').value||null, supplier_id:$('doForn').value||null,
        financial_account_id:$('doAcc').value||null, categoria_id:$('doCat').value||null,
        status:$('doSt').value, storage_path };
      let res, docId;
      if(creating){ payload.company_id=co; res=await db.from('documents').insert(payload).select('id').single(); docId=res.data&&res.data.id; }
      else res=await db.from('documents').update(payload).eq('id',rec.id);
      if(res.error) throw res.error;
      if(req && docId){ await db.from('document_requests').update({status:'recebido',document_id:docId}).eq('id',req.id); }
      closeModal(); toast('Documento salvo!'); loadDocs();
    }catch(err){ toast('Erro: '+(err.message||err),'err'); }
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
  };
}
async function delDoc(rec){
  const ok=await confirmModal({titulo:'Excluir documento',texto:`Excluir “${rec.nome}”? O arquivo também será removido.`,ok:'Excluir',perigo:true});
  if(!ok) return;
  if(rec.storage_path){ await db.storage.from('documentos').remove([rec.storage_path]); }
  const { error }=await db.from('documents').delete().eq('id',rec.id);
  if(error){ toast('Erro ao excluir.','err'); return; } toast('Excluído.'); loadDocs();
}
function openDocSolicitar(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Solicitar documento</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      <div class="field"><label>Empresa *</label><select id="srCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo de documento</label><input id="srTipo" placeholder="NF, comprovante…"></div>
      <div class="field" style="grid-column:1/3"><label>Descrição *</label><input id="srDesc" placeholder="ex: NF de setembro do fornecedor X"></div>
      <div class="field"><label>Responsável</label><select id="srResp"><option value="">—</option>${docCache.profiles.map(p=>`<option value="${p.id}">${esc(p.nome||p.email)}</option>`).join('')}</select></div>
      <div class="field"><label>Prioridade</label><select id="srPrio">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${k==='media'?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Competência</label><input id="srComp" type="date"></div>
      <div class="field"><label>Prazo</label><input id="srPrazo" type="date"></div>
    </div><div class="hint" style="margin-top:8px">Ao solicitar, uma pendência do tipo “Documento” é criada automaticamente.</div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Solicitar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const desc=$('srDesc').value.trim(); if(!desc){toast('Informe a descrição.','err');return;}
    const co=$('srCo').value;
    $('mSave').disabled=true; $('mSave').textContent='Solicitando…';
    const req={ company_id:co, descricao:desc, tipo_documento:$('srTipo').value||null,
      assigned_user_id:$('srResp').value||null, competencia:$('srComp').value||null,
      prazo:$('srPrazo').value||null, prioridade:$('srPrio').value, status:'solicitado' };
    const r1=await db.from('document_requests').insert(req);
    if(r1.error){ $('mSave').disabled=false; $('mSave').textContent='Solicitar'; toast('Erro: '+r1.error.message,'err'); return; }
    await db.from('pending_items').insert({ company_id:co, tipo:'documento', titulo:'Documento solicitado: '+desc,
      descricao:$('srTipo').value||null, prioridade:$('srPrio').value, assigned_user_id:$('srResp').value||null,
      prazo:$('srPrazo').value||null, status:'aberta', origem:'manual' });
    $('mSave').disabled=false; $('mSave').textContent='Solicitar';
    closeModal(); toast('Documento solicitado e pendência criada!'); loadDocs();
  };
}

/* ===================== CONTROLADORIA — DRE ===================== */
const MESNOME=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let dreItems=[], dreCatNat={}, dreMesSel=todayStr().slice(0,7);

async function renderDre(){
  $('main').innerHTML=`<div class="page-h"><h1>DRE Gerencial</h1><span class="scope">${companyId?'':'· consolidada (todas as empresas)'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnMap">Mapear categorias</button></div></div>
    <div class="updated">Por competência. Compara com o mês anterior e mostra o acumulado do ano.</div>
    <div class="filters"><div class="fg dre-mes"><label>Mês (competência)</label><input type="month" id="dreMes" value="${dreMesSel}"></div></div>
    <div id="dreArea"><div class="loading">Carregando…</div></div>`;
  $('btnMap').onclick=openDreMap;
  $('dreMes').onchange=e=>{ dreMesSel=e.target.value||dreMesSel; refreshDre(); };
  await refreshDre();
}

async function loadDreBase(){
  const [items,maps]=await Promise.all([
    db.from('dre_structure_items').select('*').is('company_id',null).order('ordem'),
    db.from('dre_category_mappings').select('categoria_id,dre_item_id'),
  ]);
  dreItems=items.data||[];
  const nat={}; dreItems.forEach(i=>{ if(i.tipo==='linha') nat[i.id]=i.natureza; });
  dreCatNat={}; (maps.data||[]).forEach(m=>{ if(nat[m.dre_item_id]) dreCatNat[m.categoria_id]=nat[m.dre_item_id]; });
}

async function refreshDre(){
  $('dreArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    await loadDreBase();
    if(!Object.keys(dreCatNat).length){
      $('dreArea').innerHTML='<div class="panel"><div class="empty">Nenhuma categoria mapeada ainda.<br>Clique em <b>“Mapear categorias”</b> para dizer em que linha da DRE cada categoria entra.</div></div>';
      return;
    }
    const ano=+dreMesSel.slice(0,4), mIdx=+dreMesSel.slice(5,7)-1;
    const ini=ano+'-01-01', fim=ano+'-12-31';
    const [rec,pag]=await Promise.all([
      scopeQ(db.from('receivable_installments').select('valor,competencia,status,company_id, receivables(categoria_id)')).gte('competencia',ini).lte('competencia',fim),
      scopeQ(db.from('payable_installments').select('valor,competencia,status,company_id, payables(categoria_id)')).gte('competencia',ini).lte('competencia',fim),
    ]);
    if(rec.error) throw rec.error; if(pag.error) throw pag.error;

    // soma por natureza por mês (0-11)
    const lineSums={}; let semMap=0;
    const push=(cat,comp,valor)=>{ const n=dreCatNat[cat]; if(!n){ semMap++; return; } const mi=+comp.slice(5,7)-1;
      (lineSums[n]=lineSums[n]||Array(12).fill(0))[mi]+=Number(valor||0); };
    (rec.data||[]).forEach(r=>{ if(r.status==='cancelado'||!r.competencia) return; push(r.receivables&&r.receivables.categoria_id, r.competencia, r.valor); });
    (pag.data||[]).forEach(p=>{ if(p.status==='cancelado'||!p.competencia) return; push(p.payables&&p.payables.categoria_id, p.competencia, p.valor); });

    const compute=getVal=>{ // retorna array {item,value} com subtotais correndo
      let run=0; return dreItems.map(it=>{
        if(it.tipo==='linha'){ const v=getVal(it.natureza); run += (it.operador==='subtrai'? -v : v); return {it,value:v}; }
        return {it,value:run};
      });
    };
    const valMes=n=>lineSums[n]?lineSums[n][mIdx]:0;
    const valAnt=n=>(mIdx>0 && lineSums[n])?lineSums[n][mIdx-1]:0;
    const valAcc=n=>lineSums[n]?lineSums[n].slice(0,mIdx+1).reduce((s,x)=>s+x,0):0;
    const atual=compute(valMes), anterior=compute(valAnt), acumul=compute(valAcc);

    const rows=dreItems.map((it,i)=>{
      const a=atual[i].value, b=anterior[i].value, ac=acumul[i].value;
      const vari=a-b; const pct=b!==0?(vari/Math.abs(b)*100):null;
      const sub=it.tipo==='subtotal';
      const col=v=>`<td class="r ${v<0?'dre-neg':''}">${money(v)}</td>`;
      return `<tr class="${sub?'dre-sub':''}">
        <td>${esc(it.titulo)}</td>
        ${col(a)}${col(b)}
        <td class="r ${vari<0?'dre-neg':(vari>0?'dre-pos':'')}">${money(vari)}</td>
        <td class="r">${pct===null?'—':(pct>0?'+':'')+pct.toFixed(1)+'%'}</td>
        ${col(ac)}</tr>`;
    }).join('');

    const aviso=semMap?`<div class="box" style="margin-bottom:12px;background:#fff7e6;border-color:#fde3b0">⚠️ ${semMap} lançamento(s) com categoria <b>sem mapeamento</b> não entraram na DRE. Clique em “Mapear categorias”.</div>`:'';
    $('dreArea').innerHTML=`${aviso}<div class="panel"><h3><span class="dot t"></span>${MESNOME[mIdx]}/${ano}${companyId?'':' · consolidado'}</h3>
      <table><thead><tr><th>Descrição</th><th class="r">Mês atual</th><th class="r">Mês anterior</th><th class="r">Variação</th><th class="r">%</th><th class="r">Acumulado ano</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }catch(err){ $('dreArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}

/* ---------- MAPEAMENTO categoria -> linha DRE ---------- */
async function openDreMap(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Mapear categorias → DRE</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa</label><select id="dmCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="hint" style="margin-bottom:12px">Diga em que linha da DRE cada categoria entra. Salva automaticamente.</div>
      <div id="dmArea"><div class="loading">Carregando…</div></div>
    </div>
    <div class="modal-f"><button class="btn" id="mClose">Concluir</button></div>
  </div></div>`;
  $('mx').onclick=$('mClose').onclick=()=>{ closeModal(); refreshDre(); };
  await loadDreBase();
  const linhas=dreItems.filter(i=>i.tipo==='linha');
  async function loadMapRows(co){
    const [cats,maps]=await Promise.all([
      db.from('categories').select('id,nome,tipo').eq('company_id',co).order('tipo').order('nome'),
      db.from('dre_category_mappings').select('categoria_id,dre_item_id').eq('company_id',co),
    ]);
    const cur={}; (maps.data||[]).forEach(m=>cur[m.categoria_id]=m.dre_item_id);
    const rows=(cats.data||[]);
    if(!rows.length){ $('dmArea').innerHTML='<div class="empty">Essa empresa não tem categorias. Cadastre em Categorias primeiro.</div>'; return; }
    $('dmArea').innerHTML=`<table><thead><tr><th>Categoria</th><th>Tipo</th><th>Linha da DRE</th></tr></thead><tbody>
      ${rows.map(c=>`<tr><td>${esc(c.nome)}</td>
        <td><span class="pill ${c.tipo==='receita'?'st-recebido':'st-vencido'}">${c.tipo}</span></td>
        <td><select class="stsel" data-cat="${c.id}"><option value="">— não entra —</option>
          ${linhas.map(l=>`<option value="${l.id}" ${cur[c.id]===l.id?'selected':''}>${esc(l.titulo)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table>`;
    $('dmArea').querySelectorAll('[data-cat]').forEach(s=>s.onchange=()=>saveMap(co,s.dataset.cat,s.value));
  }
  await loadMapRows(defaultCo);
  $('dmCo').onchange=()=>loadMapRows($('dmCo').value);
}
async function saveMap(co,catId,itemId){
  if(!itemId){ const { error }=await db.from('dre_category_mappings').delete().eq('company_id',co).eq('categoria_id',catId);
    if(error){toast('Erro.','err');return;} toast('Mapeamento removido.'); return; }
  const { error }=await db.from('dre_category_mappings').upsert({company_id:co,categoria_id:catId,dre_item_id:itemId},{onConflict:'company_id,categoria_id'});
  if(error){ toast('Erro ao salvar: '+error.message,'err'); return; } toast('Mapeado.');
}

boot();