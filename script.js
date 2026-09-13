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
const scopeQ = q => companyId ? q.eq('company_id',companyId) : q;

const MENU = [
  {g:'Principal', items:[{ico:'▚',label:'Dashboard',view:'dashboard'}]},
  {g:'Financeiro', items:[
    {ico:'↘',label:'Contas a receber',view:'contas-receber'},
    {ico:'↗',label:'Contas a pagar',view:'contas-pagar'},
    {ico:'≋',label:'Fluxo de caixa',soon:true},
  ]},
  {g:'Cadastros', items:[
    {ico:'◎',label:'Clientes',soon:true},{ico:'◍',label:'Fornecedores',soon:true},
    {ico:'⌗',label:'Categorias',soon:true},{ico:'⊞',label:'Centros de custo',soon:true},
    {ico:'▤',label:'Contas financeiras',soon:true},{ico:'▦',label:'Empresas',soon:true},
  ]},
  {g:'Gestão', items:[{ico:'◆',label:'Controladoria',soon:true},{ico:'◈',label:'BPO',soon:true}]},
];
function renderMenu(){
  const side=$('side'); side.innerHTML='';
  MENU.forEach(grp=>{
    side.appendChild(el('div','nav-group',grp.g));
    grp.items.forEach(it=>{
      const cls='nav-item '+(it.soon?'soon':'link')+(it.view===currentView?' active':'');
      const node=el('div',cls,`<span class="ico">${it.ico}</span><span class="label">${it.label}</span>${it.soon?'<span class="tag">em breve</span>':''}`);
      if(!it.soon) node.onclick=()=>setView(it.view);
      side.appendChild(node);
    });
  });
}
function setView(v){ currentView=v; renderMenu(); if(v==='dashboard')renderDashboard(); else if(v==='contas-receber')renderContasReceber(); else if(v==='contas-pagar')renderContasPagar(); }

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
  await loadCompanies();
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

boot();