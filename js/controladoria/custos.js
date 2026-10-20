/* ===================== undefined ===================== */
// --- centro de custo padrão da categoria: preenche sozinho nos formulários ---
const ccPadraoCache={};
async function ccPadraoDe(catId){
  if(!catId) return null;
  if(!(catId in ccPadraoCache)){
    const { data }=await db.from('categories').select('default_cost_center_id').eq('id',catId).maybeSingle();
    ccPadraoCache[catId]=data?data.default_cost_center_id:null;
  }
  return ccPadraoCache[catId];
}
function limparCCPadraoCache(){ Object.keys(ccPadraoCache).forEach(k=>delete ccPadraoCache[k]); }
// só preenche se o centro de custo estiver vazio ou ainda com o valor que ele mesmo preencheu
function ligarCCPadrao(cat, cc){
  if(!cat||!cc||cat.dataset.ccPadrao) return;
  cat.dataset.ccPadrao='1'; let auto='';
  cat.addEventListener('change', async ()=>{
    const def=await ccPadraoDe(cat.value);
    if(cc.value && cc.value!==auto) return;
    if(!def){ if(auto && cc.value===auto){ cc.value=''; auto=''; } return; }
    if(![...cc.options].some(o=>o.value===def)) return;
    cc.value=def; auto=def; cc.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
const CC_PARES=[['nCat','nCC'],['pnCat','pnCC'],['dcCat','dcCC'],['clCat','clCC'],['reCat','reCC'],['rgCat','rgCC']];
new MutationObserver(()=>CC_PARES.forEach(([a,b])=>ligarCCPadrao($(a),$(b)))).observe($('modalRoot'),{childList:true,subtree:true});

// --- rateio por título ---
function rateioLinha(tipo, t){
  const rat=(t.rateio_centro_custo||[]).slice().sort((a,b)=>b.percentual-a.percentual);
  const cc=t.cc_titulo&&t.cc_titulo.nome;
  const txt=rat.length?'Rateio: '+rat.map(r=>`<b>${esc(r.cost_centers?r.cost_centers.nome:'?')}</b> ${fmtPct(r.percentual)}`).join(' · ')
    :'Centro de custo: '+(cc?`<b>${esc(cc)}</b>`:'<span style="color:var(--muted)">não informado</span>');
  return `<tr class="inst-row"><td colspan="8" style="padding-left:38px;font-size:12.5px">${txt}
    <button class="lnk" data-rateio="${t.id}" data-rtipo="${tipo}" style="margin-left:8px">${rat.length?'Editar rateio':'Ratear entre centros de custo'}</button></td></tr>`;
}
function ligarRateio(area, tipo, lista){
  area.querySelectorAll('[data-rateio]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const t=lista.find(x=>x.id===b.dataset.rateio); if(t) openRateio(tipo,t); });
}
async function openRateio(tipo, t){
  const { data:ccs, error }=await db.from('cost_centers').select('id,nome').eq('company_id',t.company_id).order('nome');
  if(error){ toast('Erro: '+error.message,'err'); return; }
  if(!(ccs||[]).length){ toast('Cadastre os centros de custo dessa empresa primeiro (Cadastros → Centros de custo).','err'); return; }
  const tinha=(t.rateio_centro_custo||[]).length>0;
  let rows=tinha?t.rateio_centro_custo.map(r=>({cc:r.cost_center_id,pct:Number(r.percentual)})):[{cc:t.cost_center_id||'',pct:100}];
  const V=Number(t.valor_total||0);
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Rateio entre centros de custo</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box"><b>${esc(t.descricao)}</b> · ${money(V)}<br>O valor de cada parcela é dividido pelos percentuais nos relatórios de custos. A soma precisa dar 100%.</div>
      <table><thead><tr><th>Centro de custo</th><th class="r" style="width:110px">%</th><th class="r" style="width:130px">Valor</th><th style="width:30px"></th></tr></thead><tbody id="raBody"></tbody></table>
      <div style="display:flex;gap:10px;margin-top:8px"><button class="lnk" id="raAdd">+ centro de custo</button><button class="lnk" id="raIgual">Dividir igual</button></div>
    </div>
    <div class="modal-f"><span id="raTot" style="margin-right:auto;font-size:13px"></span>
      ${tinha?'<button class="btn ghost" id="raDel" style="color:var(--red)">Remover rateio</button>':''}
      <button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar rateio</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const total=()=>Math.round(rows.reduce((s,r)=>s+(Number(r.pct)||0),0)*100)/100;
  const resumo=()=>{ const tt=total(); $('raTot').innerHTML=`Total: <b style="color:${Math.abs(tt-100)<=0.01?'var(--green)':'var(--red)'}">${fmtPct(tt)}</b>${Math.abs(tt-100)>0.01?` (falta ${fmtPct(100-tt)})`:''}`;
    rows.forEach((r,i)=>{ const c=document.querySelector(`[data-raval="${i}"]`); if(c) c.textContent=money(V*(Number(r.pct)||0)/100); }); };
  const draw=()=>{
    $('raBody').innerHTML=rows.map((r,i)=>`<tr>
      <td><select data-racc="${i}"><option value="">— escolha —</option>${ccs.map(c=>`<option value="${c.id}" ${c.id===r.cc?'selected':''}>${esc(c.nome)}</option>`).join('')}</select></td>
      <td><input data-rapct="${i}" type="number" step="0.01" min="0" max="100" value="${r.pct}" class="r"></td>
      <td class="r" data-raval="${i}"></td>
      <td>${rows.length>1?`<button class="lnk del" data-radel="${i}">✕</button>`:''}</td></tr>`).join('');
    $('raBody').querySelectorAll('[data-racc]').forEach(s=>s.onchange=()=>{ rows[+s.dataset.racc].cc=s.value; });
    $('raBody').querySelectorAll('[data-rapct]').forEach(s=>s.oninput=()=>{ rows[+s.dataset.rapct].pct=Number(s.value); resumo(); });
    $('raBody').querySelectorAll('[data-radel]').forEach(b=>b.onclick=()=>{ rows.splice(+b.dataset.radel,1); draw(); });
    resumo();
  };
  draw();
  $('raAdd').onclick=()=>{ const usados=new Set(rows.map(r=>r.cc)); const prox=ccs.find(c=>!usados.has(c.id)); rows.push({cc:prox?prox.id:'',pct:Math.max(0,Math.round((100-total())*100)/100)}); draw(); };
  $('raIgual').onclick=()=>{ const n=rows.length, base=Math.floor(10000/n)/100; rows.forEach((r,i)=>r.pct=i<n-1?base:Math.round((100-base*(n-1))*100)/100); draw(); };
  const salvar=async itens=>{
    $('mSave').disabled=true;
    const { error }=await db.rpc('salvar_rateio',{ p_tipo:tipo, p_titulo_id:t.id, p_itens:itens });
    $('mSave').disabled=false;
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast(itens.length?'Rateio salvo!':'Rateio removido.'); tipo==='pagar'?loadPagar():loadReceber();
  };
  if(tinha) $('raDel').onclick=async ()=>{ const ok=await confirmOver({titulo:'Remover rateio',texto:'O título volta a contar 100% no centro de custo dele. Confirmar?',ok:'Remover'}); if(ok) salvar([]); };
  $('mSave').onclick=()=>{
    if(rows.some(r=>!r.cc)){ toast('Escolha o centro de custo em todas as linhas.','err'); return; }
    if(new Set(rows.map(r=>r.cc)).size!==rows.length){ toast('O mesmo centro de custo aparece duas vezes.','err'); return; }
    if(rows.some(r=>!(r.pct>0))){ toast('Todo percentual precisa ser maior que zero.','err'); return; }
    if(Math.abs(total()-100)>0.01){ toast('Os percentuais precisam somar 100%.','err'); return; }
    salvar(rows.map(r=>({cost_center_id:r.cc, percentual:r.pct})));
  };
}

// --- relatório: custos por centro de custo / por categoria agrupada ---
let cuAno=new Date().getFullYear(), cuMes=0, cuTab='cc', cuCC='', cuOpen=new Set(), cuData=[], cuView=null;
async function renderCustos(){
  $('main').innerHTML=`<div class="page-h"><h1>Custos e centros de custo</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="cuCsv">Exportar Excel (CSV)</button></div></div>
    <div class="updated">Por competência, com o rateio aplicado. Clique numa linha pra abrir o detalhe.</div>
    <div class="filters">
      <div class="fg"><label>Ano</label><input id="cuAno" type="number" value="${cuAno}" style="max-width:110px"></div>
      <div class="fg"><label>Período</label><select id="cuMes"><option value="0">Ano todo</option>${MES3.map((m,i)=>`<option value="${i+1}" ${cuMes===i+1?'selected':''}>${MESNOME[i]}</option>`).join('')}</select></div>
      <div class="fg"><label>Visão</label><select id="cuTab"><option value="cc" ${cuTab==='cc'?'selected':''}>Por centro de custo</option><option value="cat" ${cuTab==='cat'?'selected':''}>Por categoria (agrupada)</option></select></div>
      <div class="fg" id="cuCCwrap" style="${cuTab==='cat'?'':'display:none'}"><label>Centro de custo</label><select id="cuCC"></select></div>
    </div>
    <div id="cuArea"><div class="loading">Carregando…</div></div>`;
  $('cuAno').onchange=e=>{ cuAno=+e.target.value||cuAno; loadCustos(); };
  $('cuMes').onchange=e=>{ cuMes=+e.target.value; loadCustos(); };
  $('cuTab').onchange=e=>{ cuTab=e.target.value; $('cuCCwrap').style.display=cuTab==='cat'?'':'none'; drawCustos(); };
  $('cuCC').onchange=e=>{ cuCC=e.target.value; drawCustos(); };
  $('cuCsv').onclick=()=>{ if(!cuView){ toast('Nada pra exportar ainda.','err'); return; } baixarCsv(cuView.arquivo, cuView.titulo, cuView.head, cuView.rows); };
  await loadCustos();
}
async function loadCustos(){
  $('cuArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    const { data, error }=await db.rpc('custos_por_cc',{ p_company:companyId||null, p_ini:mesIni(cuAno,cuMes||1), p_fim:mesIni(cuAno,cuMes||12) });
    if(error) throw error;
    cuData=(data||[]).map(d=>({...d, valor:Number(d.valor)}));
    // opções do filtro de centro de custo
    const ccs=new Map(); cuData.forEach(d=>ccs.set(d.cost_center_id||'_sem', d.centro_custo));
    if(cuCC && !ccs.has(cuCC)) cuCC='';
    $('cuCC').innerHTML='<option value="">Todos</option>'+[...ccs].sort((a,b)=>a[0]==='_sem'?1:b[0]==='_sem'?-1:a[1].localeCompare(b[1])).map(([k,n])=>`<option value="${k}" ${k===cuCC?'selected':''}>${esc(n)}</option>`).join('');
    drawCustos();
  }catch(err){ cuView=null; $('cuArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}<br>Rodou o candidus_custos.sql?</div></div>`; }
}
function drawCustos(){ if(!cuData.length){ cuView=null; $('cuArea').innerHTML='<div class="panel"><div class="empty">Nenhum lançamento neste período.</div></div>'; return; } cuTab==='cc'?drawCustosCC():drawCustosCat(); }
// agrupa linhas por categoria-pai → [{key,nome,total,filhos:[{nome,total,direto}]}]
function custosAgrupar(rows){
  const g={};
  rows.forEach(d=>{
    const key=d.categoria_pai_id||d.categoria_id||'_semcat';
    const grp=g[key]||(g[key]={key, nome:d.categoria_pai_id?d.categoria_pai:d.categoria, total:0, filhos:{}});
    grp.total+=d.valor;
    const fk=d.categoria_id||'_semcat';
    const f=grp.filhos[fk]||(grp.filhos[fk]={nome:d.categoria, total:0, direto:!d.categoria_pai_id});
    f.total+=d.valor;
  });
  return Object.values(g).map(x=>({...x, filhos:Object.values(x.filhos).sort((a,b)=>b.total-a.total)})).sort((a,b)=>b.total-a.total);
}
function custosGruposHtml(grupos, prefixo, base){
  return grupos.map(gp=>{
    const unico=gp.filhos.length===1 && gp.filhos[0].direto;
    const k=prefixo+gp.key, open=cuOpen.has(k);
    const pct=base?` <span class="dre-av">${fmtPct(gp.total/base*100)}</span>`:'';
    let h=`<tr class="${unico?'':'title-row'}" ${unico?'':`data-cuk="${esc(k)}"`}><td>${unico?'':`<span class="caret ${open?'open':''}">▶</span>`}${esc(gp.nome)}</td><td class="r">${money(gp.total)}${pct}</td></tr>`;
    if(open && !unico) h+=gp.filhos.map(f=>`<tr class="inst-row"><td style="padding-left:38px">${esc(f.nome)}${f.direto?' <span class="dre-av">(lançado direto no grupo)</span>':''}</td><td class="r">${money(f.total)}${base?` <span class="dre-av">${fmtPct(f.total/base*100)}</span>`:''}</td></tr>`).join('');
    return h;
  }).join('');
}
function ligarCuToggle(){ $('cuArea').querySelectorAll('[data-cuk]').forEach(tr=>tr.onclick=()=>{ const k=tr.dataset.cuk; cuOpen.has(k)?cuOpen.delete(k):cuOpen.add(k); drawCustos(); }); }
function drawCustosCC(){
  const per=cuMes?`${MESNOME[cuMes-1]}/${cuAno}`:`Ano ${cuAno}`;
  const m={};
  cuData.forEach(d=>{ const k=d.cost_center_id||'_sem'; const x=m[k]||(m[k]={k,nome:d.centro_custo,rec:0,desp:0,linhas:[],mesD:Array(12).fill(0)});
    if(d.origem==='receber') x.rec+=d.valor; else { x.desp+=d.valor; x.mesD[+d.mes.slice(5,7)-1]+=d.valor; } x.linhas.push(d); });
  const lista=Object.values(m).sort((a,b)=>a.k==='_sem'?1:b.k==='_sem'?-1:b.desp-a.desp);
  const tR=lista.reduce((s,x)=>s+x.rec,0), tD=lista.reduce((s,x)=>s+x.desp,0);
  const rows=lista.map(x=>{
    const k='cc:'+x.k, open=cuOpen.has(k);
    let h=`<tr class="title-row" data-cuk="${esc(k)}" ${x.k==='_sem'?'style="color:var(--amber)"':''}><td><span class="caret ${open?'open':''}">▶</span>${esc(x.nome)}</td>
      <td class="r">${money(x.rec)}</td><td class="r">${money(x.desp)}</td><td class="r ${x.rec-x.desp<0?'dre-neg':''}">${money(x.rec-x.desp)}</td><td class="r">${tD?fmtPct(x.desp/tD*100):'—'}</td></tr>`;
    if(open){
      const d=custosAgrupar(x.linhas.filter(l=>l.origem==='pagar')), r=custosAgrupar(x.linhas.filter(l=>l.origem==='receber'));
      h+=`<tr><td colspan="5" style="padding:0;background:var(--panel-2,#f7fafb)"><div style="padding:8px 14px 12px 34px">
        ${r.length?`<div class="ind-grupo" style="margin-top:4px">Receitas</div><table style="margin:0"><tbody>${custosGruposHtml(r,k+'|r|',x.rec)}</tbody></table>`:''}
        ${d.length?`<div class="ind-grupo">Despesas</div><table style="margin:0"><tbody>${custosGruposHtml(d,k+'|d|',x.desp)}</tbody></table>`:''}
      </div></td></tr>`;
    }
    return h;
  }).join('');
  const sem=m._sem&&(m._sem.desp+m._sem.rec);
  const aviso=sem?`<div class="box warnbox" style="margin-bottom:12px">⚠️ ${money(sem)} sem centro de custo no período. Informe o centro de custo nos lançamentos, ou defina um <b>centro de custo padrão</b> nas categorias pra vir preenchido.</div>`:'';
  let mensal='';
  if(!cuMes){
    const ls=lista.filter(x=>x.desp);
    mensal=`<div class="panel" style="margin-top:16px"><h3><span class="dot r"></span>Despesas por centro de custo, mês a mês · ${cuAno}</h3><div style="overflow-x:auto"><table class="dre-tbl"><thead><tr><th>Centro de custo</th>${MES3.map(n=>`<th class="r">${n}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${ls.map(x=>`<tr><td>${esc(x.nome)}</td>${x.mesD.map(v=>`<td class="r">${v?money(v):'—'}</td>`).join('')}<td class="r"><b>${money(x.desp)}</b></td></tr>`).join('')}
      <tr class="dre-sub"><td>Total</td>${MES3.map((n,i)=>`<td class="r">${money(ls.reduce((s,x)=>s+x.mesD[i],0))}</td>`).join('')}<td class="r">${money(tD)}</td></tr></tbody></table></div></div>`;
  }
  $('cuArea').innerHTML=`${aviso}<div class="panel"><h3><span class="dot t"></span>Resultado por centro de custo · ${per}${companyId?'':' · consolidado'}</h3>
    <table><thead><tr><th>Centro de custo</th><th class="r">Receitas</th><th class="r">Despesas</th><th class="r">Resultado</th><th class="r">% das despesas</th></tr></thead>
    <tbody>${rows}<tr class="dre-sub"><td>Total</td><td class="r">${money(tR)}</td><td class="r">${money(tD)}</td><td class="r">${money(tR-tD)}</td><td class="r">${tD?'100%':'—'}</td></tr></tbody></table></div>${mensal}`;
  ligarCuToggle();
  cuView={arquivo:`Custos_por_CC_${per.replace(/\W+/g,'_')}.csv`, titulo:`Resultado por centro de custo — ${per}`, head:['Centro de custo','Receitas','Despesas','Resultado','% das despesas'],
    rows:[...lista.map(x=>[x.nome,x.rec,x.desp,x.rec-x.desp,tD?x.desp/tD*100:'']),['Total',tR,tD,tR-tD,tD?100:'']]};
}
function drawCustosCat(){
  const per=cuMes?`${MESNOME[cuMes-1]}/${cuAno}`:`Ano ${cuAno}`;
  const rows=cuData.filter(d=>!cuCC||(d.cost_center_id||'_sem')===cuCC);
  const ccNome=cuCC?(rows[0]&&rows[0].centro_custo)||'':'';
  const sec=(origem,titulo,dot)=>{
    const ls=rows.filter(d=>d.origem===origem); if(!ls.length) return '';
    const tot=ls.reduce((s,d)=>s+d.valor,0), grupos=custosAgrupar(ls);
    return {html:`<div class="panel" style="margin-bottom:16px"><h3><span class="dot ${dot}"></span>${titulo} · ${money(tot)}</h3>
      <table><thead><tr><th>Categoria</th><th class="r">Valor · % do total</th></tr></thead><tbody>${custosGruposHtml(grupos,'cat|'+origem+'|',tot)}</tbody></table></div>`, grupos, tot};
  };
  const R=sec('receber','Receitas','g'), D=sec('pagar','Despesas','r');
  $('cuArea').innerHTML=(R||D)?`<div class="updated" style="margin-bottom:8px">${per}${cuCC?` · centro de custo: <b>${esc(ccNome)}</b>`:''}${companyId?'':' · consolidado'}</div>${R?R.html:''}${D?D.html:''}`
    :'<div class="panel"><div class="empty">Nada neste filtro.</div></div>';
  ligarCuToggle();
  const csv=[]; [['Receitas',R],['Despesas',D]].forEach(([n,s])=>{ if(!s) return; csv.push([n,s.tot,'']); s.grupos.forEach(g=>{ csv.push(['  '+g.nome,g.total,s.tot?g.total/s.tot*100:'']); if(!(g.filhos.length===1&&g.filhos[0].direto)) g.filhos.forEach(f=>csv.push(['      '+f.nome,f.total,s.tot?f.total/s.tot*100:''])); }); });
  cuView={arquivo:`Custos_por_categoria_${per.replace(/\W+/g,'_')}.csv`, titulo:`Custos por categoria — ${per}${cuCC?' — '+ccNome:''}`, head:['Categoria','Valor','% do total'], rows:csv};
}
