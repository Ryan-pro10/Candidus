/* ===================== BAIXA EM LOTE ===================== */
let blState={co:'',tipo:'pagar',venc:'todas',rows:[],sel:new Set(),accs:[]};
async function renderBaixaLote(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  blState.co=defaultCo; blState.sel=new Set();
  $('main').innerHTML=`<div class="page-h"><h1>Baixa em lote</h1><div class="spacer"></div></div>
    <div class="updated">Marque várias parcelas e dê baixa de uma vez, de uma conta só. Baixa o saldo cheio de cada parcela.</div>
    <div class="filters">
      <div class="fg"><label>Empresa</label><select id="blCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="fg"><label>Tipo</label><select id="blTipo"><option value="pagar">Contas a pagar</option><option value="receber">Contas a receber</option></select></div>
      <div class="fg"><label>Vencimento</label><select id="blVenc"><option value="todas">Todas em aberto</option><option value="hoje">Até hoje (vencidas + hoje)</option><option value="7">Próximos 7 dias</option><option value="30">Próximos 30 dias</option></select></div>
    </div>
    <div id="blArea"><div class="loading">Carregando…</div></div>`;
  $('blCo').onchange=e=>{blState.co=e.target.value;blState.sel=new Set();loadBaixaLote();};
  $('blTipo').onchange=e=>{blState.tipo=e.target.value;blState.sel=new Set();loadBaixaLote();};
  $('blVenc').onchange=e=>{blState.venc=e.target.value;blState.sel=new Set();loadBaixaLote();};
  await loadBaixaLote();
}
async function loadBaixaLote(){
  $('blArea').innerHTML='<div class="loading">Carregando…</div>';
  try{
    const co=blState.co, tipo=blState.tipo;
    const acc=await db.from('financial_accounts').select('id,nome').eq('company_id',co).neq('tipo','cartao_credito').order('nome');
    blState.accs=acc.data||[];
    let q;
    if(tipo==='receber') q=db.from('receivable_installments').select('id,vencimento,valor,valor_recebido,saldo,status, receivables(descricao,customers(razao_social,nome_fantasia))').eq('company_id',co).in('status',['a_receber','recebido_parcial']);
    else q=db.from('payable_installments').select('id,vencimento,valor,valor_pago,saldo,status, payables(descricao,suppliers(razao_social,nome_fantasia))').eq('company_id',co).in('status',['a_pagar','pago_parcial']);
    if(blState.venc==='hoje') q=q.lte('vencimento',todayStr());
    else if(blState.venc==='7') q=q.lte('vencimento',new Date(Date.now()+7*86400000).toISOString().slice(0,10));
    else if(blState.venc==='30') q=q.lte('vencimento',new Date(Date.now()+30*86400000).toISOString().slice(0,10));
    q=q.order('vencimento').limit(300);
    const { data,error }=await q; if(error) throw error;
    blState.rows=(data||[]).filter(r=>Number(r.saldo)>0).map(r=>{
      const par=tipo==='receber'?r.receivables:r.payables;
      const cp=par&&(tipo==='receber'?par.customers:par.suppliers);
      return {id:r.id, descricao:par&&par.descricao, contraparte:cp&&(cp.nome_fantasia||cp.razao_social)||'—', vencimento:r.vencimento, saldo:Number(r.saldo), vencida:r.vencimento<todayStr()};
    });
    drawBaixaLote();
  }catch(err){ $('blArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
function blTotalSel(){ return blState.rows.filter(r=>blState.sel.has(r.id)).reduce((s,r)=>s+r.saldo,0); }
function drawBaixaLote(){
  if(!blState.rows.length){ $('blArea').innerHTML='<div class="panel"><div class="empty">Nenhuma parcela em aberto para esse filtro.</div></div>'; return; }
  const body=blState.rows.map(r=>`<tr>
    <td><input type="checkbox" data-bl="${r.id}" ${blState.sel.has(r.id)?'checked':''} style="width:16px;height:16px"></td>
    <td>${esc(r.contraparte)}</td><td>${esc(r.descricao||'—')}</td>
    <td>${fmtDate(r.vencimento)}${r.vencida?' <span class="pill st-vencido">vencida</span>':''}</td>
    <td class="r">${money(r.saldo)}</td></tr>`).join('');
  $('blArea').innerHTML=`<div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="lnk" id="blAll">Selecionar todas</button>
      <button class="lnk" id="blVenc2">Só as vencidas</button>
      <button class="lnk" id="blNone">Limpar seleção</button></div>
    <div class="panel"><table><thead><tr><th></th><th>${blState.tipo==='receber'?'Cliente':'Fornecedor'}</th><th>Descrição</th><th>Vencimento</th><th class="r">Saldo</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="panel" style="margin-top:14px;padding:16px;display:flex;gap:14px;align-items:end;flex-wrap:wrap">
      <div><div style="font-size:12px;color:var(--muted)">Selecionadas</div><div style="font-family:'Space Grotesk';font-size:18px;font-weight:700" id="blResumo">0 · ${money(0)}</div></div>
      <div class="fg" style="min-width:200px"><label>${blState.tipo==='receber'?'Receber na conta':'Pagar da conta'} *</label><select id="blAcc"><option value="">—</option>${blState.accs.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      <div class="fg"><label>Data *</label><input id="blData" type="date" value="${todayStr()}" style="max-width:170px"></div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="blGo">Dar baixa nas selecionadas</button>
    </div>`;
  const upResumo=()=>{ $('blResumo').textContent=`${blState.sel.size} · ${money(blTotalSel())}`; };
  $('blArea').querySelectorAll('[data-bl]').forEach(c=>c.onchange=()=>{ c.checked?blState.sel.add(c.dataset.bl):blState.sel.delete(c.dataset.bl); upResumo(); });
  $('blAll').onclick=()=>{ blState.rows.forEach(r=>blState.sel.add(r.id)); drawBaixaLote(); };
  $('blVenc2').onclick=()=>{ blState.sel=new Set(blState.rows.filter(r=>r.vencida).map(r=>r.id)); drawBaixaLote(); };
  $('blNone').onclick=()=>{ blState.sel=new Set(); drawBaixaLote(); };
  $('blGo').onclick=confirmarBaixaLote;
  upResumo();
}
async function confirmarBaixaLote(){
  if(!blState.sel.size){ toast('Marque ao menos uma parcela.','err'); return; }
  const acc=$('blAcc').value; if(!acc){ toast('Escolha a conta.','err'); return; }
  const data=$('blData').value||todayStr();
  const alvos=blState.rows.filter(r=>blState.sel.has(r.id));
  const ok=await confirmModal({titulo:'Confirmar baixa em lote',texto:`${alvos.length} parcela(s) · total ${money(blTotalSel())}. ${blState.tipo==='receber'?'Receber na':'Pagar da'} conta selecionada, na data ${fmtDate(data)}. Confirmar?`,ok:'Confirmar'});
  if(!ok) return;
  const fn=blState.tipo==='receber'?'baixar_receivable_installment':'baixar_payable_installment';
  let okc=0, errc=0;
  for(const r of alvos){
    const { error }=await db.rpc(fn,{ p_installment_id:r.id, p_valor:r.saldo, p_financial_account_id:acc, p_data:data });
    if(error) errc++; else okc++;
  }
  toast(`${okc} baixada(s)${errc?` · ${errc} com erro`:''}.`, errc?'err':'ok');
  loadBaixaLote();
}
