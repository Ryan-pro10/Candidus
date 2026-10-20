/* ===================== CONCILIAÇÃO ===================== */
let concState={bts:[],abertas:{receber:[],pagar:[]},tab:'conciliar',sel:new Set(),regras:new Map()};
function daysDiff(a,b){ return Math.abs(Math.round((new Date(a)-new Date(b))/86400000)); }
function nameTokens(s){ return normDesc(s).split(/[^a-z0-9]+/).filter(w=>w.length>=4); }
function descHit(btDesc, nome){ const d=normDesc(btDesc); return nameTokens(nome).some(t=>d.includes(t)); }
function sugerir(bt, lista){ // lista de parcelas abertas (do tipo certo)
  let best=null;
  for(const inst of lista){
    const dif=Math.abs(bt.valor-inst.saldo);
    const pct=inst.saldo>0?dif/inst.saldo:1;
    const prox=daysDiff(bt.data, inst.vencimento)<=5;
    const nome=descHit(bt.descricao, inst.contraparte||'');
    let conf=null, rank=0;
    if(dif<0.01){ if(nome||prox){conf='alta';rank=3;} else {conf='media';rank=2;} }
    else if(pct<=0.02){ if(nome||prox){conf='media';rank=2;} else {conf='baixa';rank=1;} }
    else if(nome){ conf='baixa';rank=1; }
    if(conf){ const score=rank*1000 - dif - daysDiff(bt.data,inst.vencimento)*0.1;
      if(!best || score>best.score) best={inst,conf,score,dif}; }
  }
  return best;
}
async function renderConciliacao(){
  $('main').innerHTML=`<div class="page-h"><h1>Conciliação</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn ghost" id="cncRegras" style="display:none">Aplicar regras</button>
    <button class="btn ghost" id="cncBulk" ${concState.tab==='conciliar'?'':'style="display:none"'}>Conciliar todas de alta confiança</button></div>
    <div class="updated">Casa os movimentos do extrato com as contas a pagar/receber. Conciliar dá baixa na conta sem lançar caixa de novo. Em <b>Escolher</b> dá pra marcar várias contas para um movimento; marcando vários movimentos, dá pra casar todos com uma conta só.</div>
    <div class="seg" style="max-width:480px;margin-bottom:18px">
      <button type="button" data-ctab="conciliar" class="${concState.tab==='conciliar'?'on':''}">A conciliar</button>
      <button type="button" data-ctab="conciliados" class="${concState.tab==='conciliados'?'on':''}">Conciliados</button>
      <button type="button" data-ctab="regras" class="${concState.tab==='regras'?'on':''}">Regras</button></div>
    <div id="cncArea"><div class="loading">Carregando…</div></div>`;
  document.querySelectorAll('[data-ctab]').forEach(b=>b.onclick=()=>{ concState.tab=b.dataset.ctab; renderConciliacao(); });
  $('cncBulk').onclick=conciliarAltas;
  $('cncRegras').onclick=()=>aplicarRegras(null);
  if(concState.tab==='regras') await loadRegras(); else await loadConciliacao();
}
async function loadConciliacao(){
  try{
    const [rec,pag]=await Promise.all([
      scopeQ(db.from('receivable_installments').select('id,receivable_id,vencimento,valor,valor_recebido,saldo,status,company_id, receivables(descricao,customers(razao_social,nome_fantasia))')),
      scopeQ(db.from('payable_installments').select('id,payable_id,vencimento,valor,valor_pago,saldo,status,company_id, payables(descricao,suppliers(razao_social,nome_fantasia))')),
    ]);
    if(rec.error) throw rec.error; if(pag.error) throw pag.error;
    concState.abertas.receber=(rec.data||[]).filter(i=>!['recebido','cancelado'].includes(i.status) && Number(i.saldo)>0)
      .map(i=>({id:i.id,company_id:i.company_id,vencimento:i.vencimento,saldo:Number(i.saldo),descricao:i.receivables&&i.receivables.descricao,contraparte:i.receivables&&i.receivables.customers&&(i.receivables.customers.nome_fantasia||i.receivables.customers.razao_social)}));
    concState.abertas.pagar=(pag.data||[]).filter(i=>!['pago','cancelado'].includes(i.status) && Number(i.saldo)>0)
      .map(i=>({id:i.id,company_id:i.company_id,vencimento:i.vencimento,saldo:Number(i.saldo),descricao:i.payables&&i.payables.descricao,contraparte:i.payables&&i.payables.suppliers&&(i.payables.suppliers.nome_fantasia||i.payables.suppliers.razao_social)}));
    if(concState.tab==='conciliar'){
      const { data:bts, error }=await scopeQ(db.from('bank_transactions').select('id,data,descricao,valor,tipo,company_id').eq('conciliado',false).in('tipo',['entrada','saida'])).order('data');
      if(error) throw error;
      concState.bts=(bts||[]).map(b=>({...b,valor:Number(b.valor)}));
      const sim=await db.rpc('simular_regras_conciliacao',{ p_company:companyId||null });
      concState.regras=new Map((sim.error?[]:(sim.data||[])).map(x=>[x.bank_transaction_id,x]));
      const bR=$('cncRegras'); if(bR){ bR.style.display=concState.regras.size?'':'none'; bR.textContent=`Aplicar regras (${concState.regras.size})`; }
      drawConciliar();
    } else {
      const { data:bts, error }=await scopeQ(db.from('bank_transactions').select('id,data,descricao,valor,tipo,juros,multa,desconto,receivable_installment_id,payable_installment_id, conciliation_rules(nome), conciliacao_itens(valor,receivable_installments(numero,total_parcelas,receivables(descricao)),payable_installments(numero,total_parcelas,payables(descricao)))').eq('conciliado',true)).order('data',{ascending:false});
      if(error) throw error;
      concState.conc=bts||[]; drawConciliados();
    }
  }catch(err){ $('cncArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
function confPill(c){ return `<span class="pill ${c==='alta'?'st-recebido':(c==='media'?'st-recebido_parcial':'st-vencido')}">${c==='alta'?'Alta':(c==='media'?'Média':'Baixa')}</span>`; }
// contas abertas do tipo certo E da mesma empresa do movimento
function abertasPara(bt){ return concState.abertas[bt.tipo==='entrada'?'receber':'pagar'].filter(i=>i.company_id===bt.company_id); }
// procura 2 a 4 contas cuja soma de saldos bate exatamente com o movimento
function sugerirCombo(bt, lista){
  const alvo=Math.round(bt.valor*100);
  const cands=lista.filter(i=>i.saldo>0 && i.saldo<=bt.valor+0.005)
    .map(i=>({i, nome:descHit(bt.descricao,i.contraparte||''), dd:daysDiff(bt.data,i.vencimento)}))
    .filter(x=>x.nome||x.dd<=10)
    .sort((a,b)=>(Number(b.nome)-Number(a.nome))||(a.dd-b.dd)).slice(0,14);
  const cents=cands.map(x=>Math.round(x.i.saldo*100));
  let best=null; const pick=[];
  (function dfs(start,sum){
    if(pick.length>=2 && sum===alvo){
      const xs=pick.map(k=>cands[k]); const allNome=xs.every(x=>x.nome);
      const score=(allNome?1000:0) - xs.length*10 - xs.reduce((t,x)=>t+x.dd,0)*0.1;
      if(!best||score>best.score) best={itens:xs.map(x=>x.i),conf:allNome?'alta':'media',score};
      return;
    }
    if(pick.length===4) return;
    for(let k=start;k<cands.length;k++){ const t=sum+cents[k]; if(t>alvo) continue; pick.push(k); dfs(k+1,t); pick.pop(); }
  })(0,0);
  return best;
}
function drawConciliar(){
  if(!concState.bts.length){ concState.sel.clear(); $('cncArea').innerHTML='<div class="panel"><div class="empty">Nenhum movimento pendente de conciliação. Importe um extrato primeiro (menu Importar extrato).</div></div>'; return; }
  const vivos=new Set(concState.bts.map(b=>b.id)); for(const id of [...concState.sel]) if(!vivos.has(id)) concState.sel.delete(id);
  const rows=concState.bts.map((bt,i)=>{
    const lista=abertasPara(bt);
    const regra=concState.regras.get(bt.id);
    const sug=regra?null:sugerir(bt,lista); let combo=null;
    if(!regra && (!sug || sug.conf!=='alta')){ const cb=sugerirCombo(bt,lista); if(cb && (!sug || cb.conf==='alta' || sug.conf==='baixa')) combo=cb; }
    bt._sug=combo?null:sug; bt._combo=combo; bt._regra=regra||null;
    let sugHtml;
    if(regra){
      sugHtml=`<span class="pill st-recebido" style="margin-right:4px">Regra</span><b>${esc(regra.regra_nome)}</b> · ${regra.acao==='transferencia'?'marca como transferência':'lança e concilia'}`;
    } else if(combo){
      const nomes=combo.itens.slice(0,3).map(x=>esc(x.descricao||'—')).join(' + ')+(combo.itens.length>3?' + …':'');
      sugHtml=`<span class="pill st-recebido_parcial" style="margin-right:4px">${combo.itens.length} contas</span>${nomes} · ${money(combo.itens.reduce((t,x)=>t+x.saldo,0))} ${confPill(combo.conf)}`;
    } else if(sug){
      sugHtml=`${esc(sug.inst.descricao||'')}${sug.inst.contraparte?' · '+esc(sug.inst.contraparte):''} · venc. ${fmtDate(sug.inst.vencimento)} · ${money(sug.inst.saldo)} ${confPill(sug.conf)}`;
    } else sugHtml='<span style="color:var(--muted)">Sem sugestão</span>';
    return `<tr>
      <td><input type="checkbox" data-sel="${bt.id}" ${concState.sel.has(bt.id)?'checked':''} style="width:16px;height:16px"></td>
      <td>${fmtDate(bt.data)}</td><td>${esc(bt.descricao)}</td>
      <td class="r" style="color:${bt.tipo==='entrada'?'var(--green)':'var(--red)'}">${bt.tipo==='entrada'?'+':'−'} ${money(bt.valor)}</td>
      <td>${sugHtml}</td>
      <td><div class="act">${regra?`<button class="mini" data-regra="${i}">Aplicar regra</button>`:((sug||combo)?`<button class="mini" data-conc="${i}">Conciliar</button>`:'')}<button class="lnk" data-pick="${i}">Escolher</button><button class="lnk" data-novo="${i}">Criar lançamento</button><button class="lnk" data-transf="${i}">Transf.</button></div></td></tr>`;
  }).join('');
  $('cncArea').innerHTML=`<div id="cncSelBar" style="display:none;align-items:center;gap:10px;margin-bottom:10px"></div>
    <div class="panel"><table><thead><tr><th></th><th>Data</th><th>Movimento</th><th class="r">Valor</th><th>Sugestão (conta)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('cncArea').querySelectorAll('[data-sel]').forEach(c=>c.onchange=()=>{ if(c.checked) concState.sel.add(c.dataset.sel); else concState.sel.delete(c.dataset.sel); updSelBar(); });
  $('cncArea').querySelectorAll('[data-conc]').forEach(b=>b.onclick=()=>{ const bt=concState.bts[+b.dataset.conc]; if(bt._combo) conciliarCombo(bt); else conciliar(bt, bt._sug.inst.id); });
  $('cncArea').querySelectorAll('[data-regra]').forEach(b=>b.onclick=()=>aplicarRegras([concState.bts[+b.dataset.regra].id]));
  $('cncArea').querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>openPickConc(concState.bts[+b.dataset.pick]));
  $('cncArea').querySelectorAll('[data-novo]').forEach(b=>b.onclick=()=>openCriarLancConc(concState.bts[+b.dataset.novo]));
  $('cncArea').querySelectorAll('[data-transf]').forEach(b=>b.onclick=async ()=>{
    const bt=concState.bts[+b.dataset.transf];
    const ok=await confirmModal({titulo:'Marcar como transferência',texto:'Este movimento vira uma transferência interna — não conta como receita nem despesa e sai da lista de conciliação. Confirmar?',ok:'Marcar'});
    if(!ok) return;
    const { error }=await db.from('bank_transactions').update({tipo:'transferencia'}).eq('id',bt.id);
    if(error){ toast('Erro: '+error.message,'err'); return; } toast('Marcado como transferência.'); loadConciliacao();
  });
  updSelBar();
}
function updSelBar(){
  const bar=$('cncSelBar'); if(!bar) return;
  const bts=concState.bts.filter(b=>concState.sel.has(b.id));
  if(bts.length<2){ bar.style.display='none'; bar.innerHTML=''; return; }
  const tot=rnd2(bts.reduce((t,b)=>t+b.valor,0));
  bar.style.display='flex';
  bar.innerHTML=`<span style="font-size:13px">${bts.length} movimentos selecionados · total <b>${money(tot)}</b></span>
    <button class="mini" id="cncSelGo">Conciliar com uma conta</button><button class="lnk" id="cncSelClr">Limpar seleção</button>`;
  $('cncSelGo').onclick=openPickVarios;
  $('cncSelClr').onclick=()=>{ concState.sel.clear(); drawConciliar(); };
}
async function conciliar(bt, instId){
  const tipo=bt.tipo==='entrada'?'receber':'pagar';
  const { error }=await db.rpc('conciliar_movimento',{ p_bank_transaction_id:bt.id, p_installment_id:instId, p_tipo:tipo });
  if(error){ toast('Erro: '+error.message,'err'); return; }
  toast('Conciliado!'); loadConciliacao();
}
async function conciliarCombo(bt){
  const c=bt._combo;
  const ok=await confirmModal({titulo:'Conciliar com várias contas',texto:`Baixar ${c.itens.length} contas (${c.itens.map(x=>x.descricao||'—').join(', ')}) com este movimento de ${money(bt.valor)}?`,ok:'Conciliar'});
  if(!ok) return;
  const { error }=await db.rpc('conciliar_movimento_multi',{ p_bank_transaction_id:bt.id, p_itens:c.itens.map(x=>({installment_id:x.id,valor:rnd2(x.saldo)})), p_juros:0, p_multa:0, p_desconto:0 });
  if(error){ toast('Erro: '+error.message,'err'); return; }
  toast(c.itens.length+' contas conciliadas!'); loadConciliacao();
}
async function conciliarAltas(){
  const alvos=concState.bts.filter(bt=>{ const s=sugerir(bt,abertasPara(bt)); return s&&s.conf==='alta'; });
  if(!alvos.length){ toast('Nenhuma sugestão de alta confiança.','err'); return; }
  const ok=await confirmModal({titulo:'Conciliar em massa',texto:`Conciliar ${alvos.length} movimento(s) de alta confiança (1 movimento ↔ 1 conta) automaticamente?`,ok:'Conciliar'});
  if(!ok) return;
  let feitos=0, erros=0;
  for(const bt of alvos){
    const s=sugerir(bt,abertasPara(bt)); if(!s||s.conf!=='alta') continue;
    const tipo=bt.tipo==='entrada'?'receber':'pagar';
    const { error }=await db.rpc('conciliar_movimento',{ p_bank_transaction_id:bt.id, p_installment_id:s.inst.id, p_tipo:tipo });
    if(error){ erros++; continue; } feitos++;
    // remove a parcela usada pra não reusar
    const arr=concState.abertas[tipo]; const idx=arr.findIndex(x=>x.id===s.inst.id); if(idx>=0) arr.splice(idx,1);
  }
  toast(feitos+' conciliado(s)!'+(erros?` ${erros} com erro.`:''), erros?'err':'ok'); loadConciliacao();
}
// 1 movimento → 1 ou várias contas
function openPickConc(bt){
  const V=bt.valor;
  const lista=abertasPara(bt).slice().sort((a,b)=>Math.abs(a.saldo-V)-Math.abs(b.saldo-V));
  const byId=Object.fromEntries(lista.map(x=>[x.id,x]));
  const sel=new Map(); let difT=null, filtro='';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Conciliar movimento</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box">${fmtDate(bt.data)} · <b>${esc(bt.descricao)}</b> · ${bt.tipo==='entrada'?'entrada':'saída'} de <b>${money(V)}</b><br>Marque uma ou mais contas. O valor de cada uma pode ser ajustado (baixa parcial).</div>
      <input id="pkBusca" placeholder="Buscar conta..." style="margin-bottom:10px">
      <div id="pkList" style="max-height:300px;overflow-y:auto"></div>
      <div id="pkResumo" class="box" style="margin:12px 0 0"></div>
    </div><div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="pkOk" disabled>Conciliar</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const resumo=()=>{
    const S=rnd2([...sel.values()].reduce((t,v)=>t+(Number(v)||0),0)); const D=rnd2(V-S);
    let dif='';
    if(!sel.size) dif='<span style="color:var(--muted)">Nenhuma conta marcada.</span>';
    else if(Math.abs(D)<0.005){ difT=null; dif='<span style="color:var(--green)">Fecha certinho.</span>'; }
    else if(D>0){ if(!['juros','multa'].includes(difT)) difT='juros';
      dif=`Sobram <b>${money(D)}</b> no movimento → lançar como <select id="pkDifT" style="width:auto;display:inline-block"><option value="juros" ${difT==='juros'?'selected':''}>juros</option><option value="multa" ${difT==='multa'?'selected':''}>multa</option></select>`; }
    else { if(!['desconto','parcial'].includes(difT)) difT='parcial';
      dif=`Faltam <b>${money(-D)}</b> para quitar as contas marcadas → <select id="pkDifT" style="width:auto;display:inline-block"><option value="parcial" ${difT==='parcial'?'selected':''}>baixa parcial (a de vencimento mais recente fica em aberto)</option><option value="desconto" ${difT==='desconto'?'selected':''}>desconto (quita todas)</option></select>`; }
    $('pkResumo').innerHTML=`Movimento <b>${money(V)}</b> · Contas marcadas <b>${money(S)}</b> (${sel.size})<br>${dif}`;
    const t=$('pkDifT'); if(t) t.onchange=e=>{ difT=e.target.value; };
    $('pkOk').disabled=!sel.size;
  };
  const draw=()=>{
    const rows=lista.filter(x=>!filtro||((x.descricao||'')+' '+(x.contraparte||'')).toLowerCase().includes(filtro.toLowerCase()));
    $('pkList').innerHTML=rows.length?rows.map(x=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border-top:1px solid var(--line)">
      <label style="display:flex;gap:10px;align-items:center;flex:1;cursor:pointer;margin:0"><input type="checkbox" data-ck="${x.id}" ${sel.has(x.id)?'checked':''} style="width:16px;height:16px">
      <div><div style="font-size:13.5px">${esc(x.descricao||'—')}${x.contraparte?' · '+esc(x.contraparte):''}</div><div style="font-size:12px;color:var(--muted)">venc. ${fmtDate(x.vencimento)} · saldo ${money(x.saldo)}</div></div></label>
      <input type="number" step="0.01" min="0.01" max="${x.saldo}" data-v="${x.id}" value="${sel.has(x.id)?sel.get(x.id):x.saldo}" ${sel.has(x.id)?'':'disabled'} style="width:110px"></div>`).join(''):'<div class="empty">Nenhuma conta aberta encontrada.</div>';
    $('pkList').querySelectorAll('[data-ck]').forEach(c=>c.onchange=()=>{ const id=c.dataset.ck, inp=$('pkList').querySelector(`[data-v="${id}"]`);
      if(c.checked){ sel.set(id, rnd2(Number(inp.value)||byId[id].saldo)); inp.disabled=false; } else { sel.delete(id); inp.disabled=true; } resumo(); });
    $('pkList').querySelectorAll('[data-v]').forEach(inp=>inp.oninput=()=>{ if(sel.has(inp.dataset.v)){ sel.set(inp.dataset.v, Number(inp.value)||0); resumo(); } });
  };
  $('pkBusca').oninput=e=>{ filtro=e.target.value; draw(); };
  draw(); resumo();
  $('pkOk').onclick=async ()=>{
    let itens=[...sel.entries()].map(([id,v])=>({installment_id:id,valor:rnd2(v)}));
    for(const it of itens){ const x=byId[it.installment_id];
      if(!(it.valor>0)){ toast('Valor inválido em “'+(x.descricao||'conta')+'”.','err'); return; }
      if(it.valor>x.saldo+0.005){ toast('“'+(x.descricao||'conta')+'”: valor maior que o saldo ('+money(x.saldo)+').','err'); return; } }
    const S=rnd2(itens.reduce((t,i)=>t+i.valor,0)); const D=rnd2(V-S);
    let juros=0, multa=0, desconto=0;
    if(D>0.005){ if(difT==='multa') multa=D; else juros=D; }
    else if(D<-0.005){
      if(difT==='desconto') desconto=-D;
      else { // baixa parcial: distribui o movimento pelo vencimento mais antigo
        let rest=V; itens.sort((a,b)=>String(byId[a.installment_id].vencimento).localeCompare(String(byId[b.installment_id].vencimento)));
        itens=itens.map(i=>{ const v=rnd2(Math.min(i.valor,rest)); rest=rnd2(rest-v); return {...i,valor:v}; }).filter(i=>i.valor>0);
      }
    }
    $('pkOk').disabled=true; $('pkOk').textContent='Conciliando…';
    const { error }=await db.rpc('conciliar_movimento_multi',{ p_bank_transaction_id:bt.id, p_itens:itens, p_juros:juros, p_multa:multa, p_desconto:desconto });
    if(error){ $('pkOk').disabled=false; $('pkOk').textContent='Conciliar'; toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast(itens.length>1?itens.length+' contas conciliadas!':'Conciliado!'); loadConciliacao();
  };
}
// vários movimentos → 1 conta
function openPickVarios(){
  const bts=concState.bts.filter(b=>concState.sel.has(b.id));
  if(bts.length<2){ toast('Selecione pelo menos 2 movimentos.','err'); return; }
  if(new Set(bts.map(b=>b.tipo)).size>1){ toast('Selecione só entradas ou só saídas.','err'); return; }
  if(new Set(bts.map(b=>b.company_id)).size>1){ toast('Selecione movimentos de uma empresa só.','err'); return; }
  const T=rnd2(bts.reduce((t,b)=>t+b.valor,0));
  const lista=abertasPara(bts[0]).slice().sort((a,b)=>Math.abs(a.saldo-T)-Math.abs(b.saldo-T));
  let esc_id=null, difT=null, filtro='';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Conciliar ${bts.length} movimentos com uma conta</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box">${bts.map(b=>`${fmtDate(b.data)} · ${esc(b.descricao)} · <b>${money(b.valor)}</b>`).join('<br>')}<br>Total: <b>${money(T)}</b> (${bts[0].tipo==='entrada'?'entradas':'saídas'})</div>
      <input id="pvBusca" placeholder="Buscar conta..." style="margin-bottom:10px">
      <div id="pvList" style="max-height:280px;overflow-y:auto"></div>
      <div id="pvResumo" class="box" style="margin:12px 0 0"></div>
    </div><div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="pvOk" disabled>Conciliar</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const resumo=()=>{
    const x=lista.find(i=>i.id===esc_id);
    if(!x){ $('pvResumo').innerHTML='<span style="color:var(--muted)">Escolha a conta.</span>'; $('pvOk').disabled=true; return; }
    const D=rnd2(T-x.saldo); let dif='';
    if(Math.abs(D)<0.005){ difT=null; dif='<span style="color:var(--green)">Fecha certinho.</span>'; }
    else if(D>0){ difT='juros'; dif=`Os movimentos passam <b>${money(D)}</b> do saldo → o excedente entra como <b>juros</b>.`; }
    else { if(!['parcial','desconto'].includes(difT)) difT='parcial';
      dif=`Faltam <b>${money(-D)}</b> → <select id="pvDifT" style="width:auto;display:inline-block"><option value="parcial" ${difT==='parcial'?'selected':''}>baixa parcial (conta fica em aberto)</option><option value="desconto" ${difT==='desconto'?'selected':''}>desconto (quita a conta)</option></select>`; }
    $('pvResumo').innerHTML=`Conta: <b>${esc(x.descricao||'—')}</b> · saldo ${money(x.saldo)} · movimentos ${money(T)}<br>${dif}`;
    const t=$('pvDifT'); if(t) t.onchange=e=>{ difT=e.target.value; };
    $('pvOk').disabled=false;
  };
  const draw=()=>{
    const rows=lista.filter(x=>!filtro||((x.descricao||'')+' '+(x.contraparte||'')).toLowerCase().includes(filtro.toLowerCase()));
    $('pvList').innerHTML=rows.length?rows.map(x=>`<label style="display:flex;gap:10px;align-items:center;padding:9px 10px;border-top:1px solid var(--line);cursor:pointer;margin:0">
      <input type="radio" name="pvConta" data-pv="${x.id}" ${esc_id===x.id?'checked':''} style="width:16px;height:16px">
      <div><div style="font-size:13.5px">${esc(x.descricao||'—')}${x.contraparte?' · '+esc(x.contraparte):''}</div><div style="font-size:12px;color:var(--muted)">venc. ${fmtDate(x.vencimento)} · saldo ${money(x.saldo)}</div></div></label>`).join(''):'<div class="empty">Nenhuma conta aberta encontrada.</div>';
    $('pvList').querySelectorAll('[data-pv]').forEach(r=>r.onchange=()=>{ esc_id=r.dataset.pv; resumo(); });
  };
  $('pvBusca').oninput=e=>{ filtro=e.target.value; draw(); };
  draw(); resumo();
  $('pvOk').onclick=async ()=>{
    if(!esc_id) return;
    $('pvOk').disabled=true; $('pvOk').textContent='Conciliando…';
    const { error }=await db.rpc('conciliar_varios_movimentos',{ p_bank_transaction_ids:bts.map(b=>b.id), p_installment_id:esc_id, p_diferenca:difT });
    if(error){ $('pvOk').disabled=false; $('pvOk').textContent='Conciliar'; toast('Erro: '+error.message,'err'); return; }
    concState.sel.clear(); closeModal(); toast(bts.length+' movimentos conciliados!'); loadConciliacao();
  };
}
async function openCriarLancConc(bt){
  const tipo=bt.tipo==='entrada'?'receber':'pagar';
  const co=bt.company_id;
  const [cat,cc,cli,forn]=await Promise.all([
    db.from('categories').select('id,nome,tipo').eq('company_id',co).eq('tipo',tipo==='receber'?'receita':'despesa').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
    tipo==='receber'?db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'):Promise.resolve({data:[]}),
    tipo==='pagar'?db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'):Promise.resolve({data:[]}),
  ]);
  const opt=(arr,lbl)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
  const contraArr = tipo==='receber'?cli:forn;
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Criar lançamento do extrato</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box">${fmtDate(bt.data)} · <b>${esc(bt.descricao)}</b> · ${bt.tipo==='entrada'?'entrada':'saída'} de <b>${money(bt.valor)}</b><br>Cria uma conta a ${tipo} e já concilia este movimento.</div>
      <div class="cadgrid">
        <div class="field" style="grid-column:1/3"><label>Descrição *</label><input id="clDesc" value="${esc(bt.descricao||'')}"></div>
        <div class="field"><label>${tipo==='receber'?'Cliente':'Fornecedor'}</label><select id="clContra">${opt(contraArr,x=>x.nome_fantasia||x.razao_social)}</select></div>
        <div class="field"><label>Categoria</label><select id="clCat">${opt(cat,x=>x.nome)}</select></div>
        <div class="field"><label>Centro de custo</label><select id="clCC">${opt(cc,x=>x.nome)}</select></div>
        <div class="field"><label>Valor</label><input value="${money(bt.valor)}" disabled></div>
      </div>
      <div class="box" style="margin:12px 0 0">
        <label style="display:flex;gap:8px;align-items:center;margin:0 0 8px"><input type="checkbox" id="clRegra" style="width:16px;height:16px"> <b>Criar regra pros próximos</b> (lança igual sozinho quando aparecer de novo)</label>
        <div id="clRegraBox" style="display:none"><label style="font-size:12px">Descrição do extrato contém</label><input id="clRegraTxt" value="${esc(sugerirTextoRegra(bt.descricao))}"></div>
      </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Criar e conciliar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('clRegra').onchange=()=>{ $('clRegraBox').style.display=$('clRegra').checked?'':'none'; };
  $('mSave').onclick=async ()=>{
    const desc=$('clDesc').value.trim(); if(!desc){toast('Informe a descrição.','err');return;}
    const querRegra=$('clRegra').checked, rTxt=$('clRegraTxt').value.trim();
    if(querRegra && !$('clCat').value){ toast('Pra criar a regra, escolha a categoria.','err'); return; }
    if(querRegra && rTxt.length<2){ toast('O texto da regra precisa ter pelo menos 2 caracteres.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Criando…';
    try{
      let rid, instTbl, instFk;
      if(tipo==='receber'){
        const r=await db.rpc('criar_conta_receber',{p_company_id:co,p_customer_id:$('clContra').value||null,p_descricao:desc,p_valor_total:bt.valor,p_primeiro_vencimento:bt.data,p_qtd_parcelas:1,p_intervalo_meses:1,p_categoria_id:$('clCat').value||null,p_cost_center_id:$('clCC').value||null,p_financial_account_id:null,p_documento:null,p_forma_recebimento:null,p_data_emissao:bt.data});
        if(r.error) throw r.error; rid=r.data; instTbl='receivable_installments'; instFk='receivable_id';
      } else {
        const r=await db.rpc('criar_conta_pagar',{p_company_id:co,p_supplier_id:$('clContra').value||null,p_descricao:desc,p_valor_total:bt.valor,p_primeiro_vencimento:bt.data,p_qtd_parcelas:1,p_intervalo_meses:1,p_categoria_id:$('clCat').value||null,p_cost_center_id:$('clCC').value||null,p_financial_account_id:null,p_documento:null,p_forma_pagamento:null,p_data_emissao:bt.data,p_competencia:null});
        if(r.error) throw r.error; rid=r.data; instTbl='payable_installments'; instFk='payable_id';
      }
      const inst=await db.from(instTbl).select('id').eq(instFk,rid).limit(1).single();
      if(inst.error) throw inst.error;
      const cc=await db.rpc('conciliar_movimento',{p_bank_transaction_id:bt.id,p_installment_id:inst.data.id,p_tipo:tipo});
      if(cc.error) throw cc.error;
      if(querRegra){
        const rg=await db.from('conciliation_rules').insert({ company_id:co, nome:rTxt, texto:rTxt, tipo_movimento:bt.tipo, acao:'lancar',
          categoria_id:$('clCat').value, cost_center_id:$('clCC').value||null,
          supplier_id:tipo==='pagar'?($('clContra').value||null):null, customer_id:tipo==='receber'?($('clContra').value||null):null, aplicar_auto:true });
        if(rg.error){ closeModal(); toast('Lançamento criado, mas a regra deu erro: '+rg.error.message,'err'); loadConciliacao(); return; }
        closeModal(); toast('Lançamento criado e regra salva! Os outros pendentes iguais já aparecem com "Aplicar regra".'); loadConciliacao(); return;
      }
      closeModal(); toast('Lançamento criado e conciliado!'); loadConciliacao();
    }catch(err){ $('mSave').disabled=false; $('mSave').textContent='Criar e conciliar'; toast('Erro: '+(err.message||err),'err'); }
  };
}
function drawConciliados(){
  const bts=concState.conc||[];
  if(!bts.length){ $('cncArea').innerHTML='<div class="panel"><div class="empty">Nenhum movimento conciliado ainda.</div></div>'; return; }
  const parc=it=>{ const r=it.receivable_installments, p=it.payable_installments, x=r||p; if(!x) return '—';
    const d=(r&&r.receivables&&r.receivables.descricao)||(p&&p.payables&&p.payables.descricao)||'—';
    return `${esc(d)}${x.total_parcelas>1?` (${x.numero}/${x.total_parcelas})`:''} · ${money(it.valor)}`; };
  const rows=bts.map((bt,i)=>{
    const itens=bt.conciliacao_itens||[];
    let contas=itens.length?itens.map(parc).join('<br>'):'<span style="color:var(--muted)">vínculo direto (baixa manual ou conciliação antiga)</span>';
    const aj=[]; if(Number(bt.juros)) aj.push('juros '+money(bt.juros)); if(Number(bt.multa)) aj.push('multa '+money(bt.multa)); if(Number(bt.desconto)) aj.push('desconto '+money(bt.desconto));
    if(aj.length) contas+=`<div style="font-size:12px;color:var(--muted)">${aj.join(' · ')}</div>`;
    if(bt.conciliation_rules) contas+=`<div style="font-size:12px;color:var(--muted)">via regra: ${esc(bt.conciliation_rules.nome)}</div>`;
    return `<tr>
    <td>${fmtDate(bt.data)}</td><td>${esc(bt.descricao)}</td>
    <td class="r" style="color:${bt.tipo==='entrada'?'var(--green)':'var(--red)'}">${bt.tipo==='entrada'?'+':'−'} ${money(bt.valor)}</td>
    <td><span class="pill st-recebido">${bt.tipo==='entrada'?'Receber':'Pagar'}</span></td>
    <td style="font-size:13px">${contas}</td>
    <td><button class="lnk del" data-undo="${i}">Desfazer</button></td></tr>`; }).join('');
  $('cncArea').innerHTML=`<div class="panel"><table><thead><tr><th>Data</th><th>Movimento</th><th class="r">Valor</th><th>Tipo</th><th>Contas</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('cncArea').querySelectorAll('[data-undo]').forEach(b=>b.onclick=async ()=>{
    const bt=bts[+b.dataset.undo];
    const n=(bt.conciliacao_itens||[]).length;
    if(n>1){ const ok=await confirmModal({titulo:'Desfazer conciliação',texto:`Este movimento baixou ${n} contas. Todas voltam a ficar em aberto. Confirmar?`,ok:'Desfazer',perigo:true}); if(!ok) return; }
    const { error }=await db.rpc('desconciliar_movimento',{ p_bank_transaction_id:bt.id });
    if(error){ toast('Erro: '+error.message,'err'); return; } toast('Conciliação desfeita.'); loadConciliacao();
  });
}
