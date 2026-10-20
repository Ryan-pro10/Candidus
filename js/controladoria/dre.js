/* ===================== undefined ===================== */
let dreItems=[], dreCatNat={}, dreMesSel=todayStr().slice(0,7), dreModo='mes', dreAV=false, dreView=null;

// valor de uma linha do dre_realizado já com o sinal da DRE
// (resultado financeiro: o que vem de conta a pagar entra negativo; "baixa" já vem com sinal)
function dreValor(d){ const v=Number(d.valor||0); return (d.natureza==='resultado_financeiro' && d.origem==='pagar')?-v:v; }
async function dreRealizado(co, ini, fim){
  const { data, error }=await db.rpc('dre_realizado',{ p_company:co||null, p_ini:ini, p_fim:fim });
  if(error) throw error; return data||[];
}

async function renderDre(){
  $('main').innerHTML=`<div class="page-h"><h1>DRE Gerencial</h1><span class="scope">${companyId?'':'· consolidada (todas as empresas)'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnDreCsv">Exportar Excel (CSV)</button><button class="btn ghost" id="btnMap">Mapear categorias</button></div></div>
    <div class="updated">Por competência. Clique numa linha pra ver as categorias que formam o valor.</div>
    <div class="filters">
      <div class="fg"><label>Visão</label><select id="dreModo">
        <option value="mes" ${dreModo==='mes'?'selected':''}>Mês × mês anterior</option>
        <option value="mensal" ${dreModo==='mensal'?'selected':''}>Mês a mês (12 meses)</option>
        <option value="trimestral" ${dreModo==='trimestral'?'selected':''}>Trimestral</option>
        <option value="anual" ${dreModo==='anual'?'selected':''}>Ano × ano anterior</option></select></div>
      <div class="fg dre-mes"><label id="dreMesLbl">Mês (competência)</label><input type="month" id="dreMes" value="${dreMesSel}"></div>
      <div class="fg"><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;margin:0;font-size:13px;cursor:pointer"><input type="checkbox" id="dreAV" ${dreAV?'checked':''} style="width:16px;height:16px"> Análise vertical (AV%)</label></div>
    </div>
    <div id="dreArea"><div class="loading">Carregando…</div></div>`;
  $('btnMap').onclick=openDreMap;
  $('btnDreCsv').onclick=exportDreCsv;
  const lbl=()=>{ $('dreMesLbl').textContent=dreModo==='mes'?'Mês (competência)':(dreModo==='anual'?'Comparar até o mês':'Ano (escolha qualquer mês)'); };
  lbl();
  $('dreModo').onchange=e=>{ dreModo=e.target.value; lbl(); refreshDre(); };
  $('dreMes').onchange=e=>{ dreMesSel=e.target.value||dreMesSel; refreshDre(); };
  $('dreAV').onchange=e=>{ dreAV=e.target.checked; if(dreView) drawDre(); };
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

// períodos (colunas de valor) de cada visão
function drePeriodos(){
  const ano=+dreMesSel.slice(0,4), m=+dreMesSel.slice(5,7);
  if(dreModo==='mes'){
    const [pa,pm]=addMes(ano,m,-1);
    return { ini:mesIni(Math.min(pa,ano), pa<ano?pm:1), fim:mesIni(ano,12), titulo:`${MESNOME[m-1]}/${ano}`, P:[
      {label:`${MESCURTO[m-1]}/${ano}`, ini:mesIni(ano,m), fim:mesIni(ano,m)},
      {label:`${MESCURTO[pm-1]}/${pa}`, ini:mesIni(pa,pm), fim:mesIni(pa,pm)},
      {label:`Acumulado ${ano}`, ini:mesIni(ano,1), fim:mesIni(ano,m)} ],
      cols:[{t:'val',p:0},{t:'av',p:0},{t:'val',p:1},{t:'var',a:0,b:1},{t:'ah',a:0,b:1},{t:'val',p:2},{t:'av',p:2}] };
  }
  if(dreModo==='mensal'){
    const P=MESCURTO.map((n,i)=>({label:n, ini:mesIni(ano,i+1), fim:mesIni(ano,i+1)}));
    P.push({label:`Total ${ano}`, ini:mesIni(ano,1), fim:mesIni(ano,12)});
    return { ini:mesIni(ano,1), fim:mesIni(ano,12), titulo:`Mês a mês · ${ano}`, P, cols:[...P.map((x,i)=>({t:'val',p:i})),{t:'av',p:12}] };
  }
  if(dreModo==='trimestral'){
    const P=[1,2,3,4].map(q=>({label:`${q}º tri`, ini:mesIni(ano,q*3-2), fim:mesIni(ano,q*3)}));
    P.push({label:`Total ${ano}`, ini:mesIni(ano,1), fim:mesIni(ano,12)});
    return { ini:mesIni(ano,1), fim:mesIni(ano,12), titulo:`Trimestral · ${ano}`, P,
      cols:[...P.slice(0,4).flatMap((x,i)=>[{t:'val',p:i},{t:'av',p:i}]),{t:'val',p:4},{t:'av',p:4}] };
  }
  // anual: ano × ano anterior até o mês escolhido (compara períodos iguais)
  const ate=m===12?'':` (jan–${MESCURTO[m-1].toLowerCase()})`;
  return { ini:mesIni(ano-1,1), fim:mesIni(ano,m), titulo:`${ano} × ${ano-1}${ate}`, P:[
      {label:`${ano}${ate}`, ini:mesIni(ano,1), fim:mesIni(ano,m)},
      {label:`${ano-1}${ate}`, ini:mesIni(ano-1,1), fim:mesIni(ano-1,m)} ],
    cols:[{t:'val',p:0},{t:'av',p:0},{t:'val',p:1},{t:'av',p:1},{t:'var',a:0,b:1},{t:'ah',a:0,b:1}] };
}
// soma por natureza (e por categoria, pro detalhamento) dentro de um período
function dreAgg(data, ini, fim){
  const out={};
  data.forEach(d=>{ if(!d.natureza || d.mes<ini || d.mes>fim) return;
    const o=out[d.natureza]||(out[d.natureza]={total:0,cats:{}}); const v=dreValor(d); o.total+=v;
    const k=d.categoria_id||'_baixas'; const c=o.cats[k]||(o.cats[k]={nome:d.categoria,valor:0}); c.valor+=v; });
  return out;
}
// valores das linhas e subtotais da DRE pra um período
function dreLinhas(agg){
  let run=0;
  return dreItems.map(it=>{ if(it.tipo==='linha'){ const v=agg[it.natureza]?agg[it.natureza].total:0; run+=(it.operador==='subtrai'?-v:v); return v; } return run; });
}

async function refreshDre(){
  $('dreArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    await loadDreBase();
    if(!Object.keys(dreCatNat).length){
      dreView=null;
      $('dreArea').innerHTML='<div class="panel"><div class="empty">Nenhuma categoria mapeada ainda.<br>Clique em <b>“Mapear categorias”</b> para dizer em que linha da DRE cada categoria entra.</div></div>';
      return;
    }
    const per=drePeriodos();
    const data=await dreRealizado(companyId, per.ini, per.fim);
    const aggs=per.P.map(p=>dreAgg(data,p.ini,p.fim));
    const vals=aggs.map(dreLinhas);
    // sem mapeamento dentro do período principal
    const p0=per.P[dreModo==='mensal'||dreModo==='trimestral'?per.P.length-1:0];
    const semMap=data.filter(d=>!d.natureza && d.mes>=p0.ini && d.mes<=p0.fim);
    dreView={per,aggs,vals,semMap};
    drawDre();
  }catch(err){ dreView=null; $('dreArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
// base da AV%: receita líquida (se zerada, receita bruta)
function dreBaseAV(valsP){
  const iRL=dreItems.findIndex(i=>i.codigo==='receita_liquida'), iRB=dreItems.findIndex(i=>i.codigo==='receita_bruta');
  const rl=iRL>=0?valsP[iRL]:0; return rl||(iRB>=0?valsP[iRB]:0);
}
// matriz da tabela (usada na tela e no CSV)
function dreMatriz(){
  const {per,vals}=dreView;
  const cols=per.cols.filter(c=>c.t!=='av'||dreAV);
  const head=cols.map(c=>c.t==='val'?per.P[c.p].label:c.t==='av'?'AV%':c.t==='var'?'Variação':'AH%');
  const linhas=dreItems.map((it,i)=>cols.map(c=>{
    if(c.t==='val') return {n:vals[c.p][i]};
    if(c.t==='av'){ const b=dreBaseAV(vals[c.p]); return {pct:b?vals[c.p][i]/Math.abs(b)*100:null}; }
    const a=vals[c.a][i], b=vals[c.b][i];
    if(c.t==='var') return {n:a-b, sig:true};
    return {pct:b!==0?(a-b)/Math.abs(b)*100:null, sig:true};
  }));
  return {cols,head,linhas};
}
function drawDre(){
  if(!dreView) return;
  const {per,semMap}=dreView; const {cols,head,linhas}=dreMatriz();
  const pctTxt=(p,sig)=>p===null||!isFinite(p)?'—':((sig&&p>0)?'+':'')+p.toFixed(1)+'%';
  const cell=(x,c)=>{
    if(x.pct!==undefined) return `<td class="r ${c.t==='av'?'dre-av':''} ${x.sig?(x.pct<0?'dre-neg':(x.pct>0?'dre-pos':'')):''}">${pctTxt(x.pct,x.sig)}</td>`;
    return `<td class="r ${x.sig?(x.n<0?'dre-neg':(x.n>0?'dre-pos':'')):(x.n<0?'dre-neg':'')}">${money(x.n)}</td>`;
  };
  const rows=dreItems.map((it,i)=>{
    const sub=it.tipo==='subtotal';
    return `<tr class="${sub?'dre-sub':'dre-click'}" ${sub?'':`data-dre="${i}" title="Ver categorias"`}><td>${esc(it.titulo)}${sub?'':' <span class="dre-lupa">›</span>'}</td>${linhas[i].map((x,j)=>cell(x,cols[j])).join('')}</tr>`;
  }).join('');
  let aviso='';
  const semCat=semMap.filter(d=>!d.categoria_id), naoMap=semMap.filter(d=>d.categoria_id);
  if(naoMap.length){
    const tot=naoMap.reduce((s,d)=>s+Number(d.valor),0), cats=new Set(naoMap.map(d=>d.categoria));
    aviso+=`<div class="box warnbox" style="margin-bottom:12px">⚠️ ${money(tot)} em ${cats.size} categoria(s) <b>sem mapeamento</b> ficaram fora da DRE: ${[...cats].slice(0,5).map(esc).join(', ')}${cats.size>5?'…':''}. Clique em “Mapear categorias”.</div>`;
  }
  if(semCat.length){
    const tot=semCat.reduce((s,d)=>s+Number(d.valor),0);
    aviso+=`<div class="box warnbox" style="margin-bottom:12px">⚠️ ${money(tot)} em <b>lançamentos sem categoria</b> ficaram fora da DRE (não dá pra mapear o que não tem categoria). <button class="lnk" id="dreSemCat">Ver e classificar</button></div>`;
  }
  $('dreArea').innerHTML=`${aviso}<div class="panel"><h3><span class="dot t"></span>${esc(per.titulo)}${companyId?'':' · consolidado'}</h3>
    <div style="overflow-x:auto"><table class="dre-tbl"><thead><tr><th>Descrição</th>${head.map((h,j)=>`<th class="r ${cols[j].t==='av'?'dre-av':''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${dreAV?'<div class="hint" style="margin-top:8px">AV% = participação sobre a receita líquida do mesmo período.</div>':''}</div>`;
  $('dreArea').querySelectorAll('[data-dre]').forEach(tr=>tr.onclick=()=>openDreDetalhe(+tr.dataset.dre));
  if($('dreSemCat')){ const p0=per.P[dreModo==='mensal'||dreModo==='trimestral'?per.P.length-1:0]; $('dreSemCat').onclick=()=>openSemCategoria(p0.ini,p0.fim); }
}
function openDreDetalhe(i){
  const it=dreItems[i]; const {per,aggs}=dreView;
  const pIdx=per.cols.filter(c=>c.t==='val').map(c=>c.p);
  const cats={};
  pIdx.forEach(p=>{ const a=aggs[p][it.natureza]; if(!a) return; Object.entries(a.cats).forEach(([k,c])=>{ (cats[k]=cats[k]||{nome:c.nome,v:{}}).v[p]=c.valor; }); });
  const lista=Object.values(cats).sort((a,b)=>Math.abs(b.v[pIdx[0]]||0)-Math.abs(a.v[pIdx[0]]||0));
  const tot=p=>lista.reduce((s,c)=>s+(c.v[p]||0),0);
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal ${pIdx.length>4?'xl':''}">
    <div class="modal-h"><h2>${esc(it.titulo.replace(/^[(=+\-\/)\s]+/,''))}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">${lista.length?`<div style="overflow-x:auto"><table><thead><tr><th>Categoria</th>${pIdx.map(p=>`<th class="r">${esc(per.P[p].label)}</th>`).join('')}</tr></thead>
      <tbody>${lista.map(c=>`<tr><td>${esc(c.nome)}</td>${pIdx.map(p=>`<td class="r ${(c.v[p]||0)<0?'dre-neg':''}">${money(c.v[p]||0)}</td>`).join('')}</tr>`).join('')}
      <tr class="dre-sub"><td>Total</td>${pIdx.map(p=>`<td class="r">${money(tot(p))}</td>`).join('')}</tr></tbody></table></div>`
      :'<div class="empty">Nenhum valor nesta linha no período.</div>'}
      ${it.natureza==='resultado_financeiro'?'<div class="hint" style="margin-top:10px">Receitas financeiras entram positivas e despesas financeiras negativas. “Juros, multas e descontos (baixas)” vem do que foi informado nas baixas e conciliações, pela data do pagamento.</div>':''}
    </div><div class="modal-f"><button class="btn" id="mCancel">Fechar</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
}
// CSV pro Excel: ; como separador, vírgula decimal, BOM pra acentos
function exportDreCsv(){
  if(!dreView){ toast('Nada pra exportar ainda.','err'); return; }
  const {head,linhas}=dreMatriz();
  const num=n=>(Math.round(n*100)/100).toFixed(2).replace('.',',');
  const q=s=>`"${String(s).replace(/"/g,'""')}"`;
  const co=companyId?(companies.find(c=>c.id===companyId)||{}):null;
  const out=[ [q('DRE Gerencial — '+dreView.per.titulo+(co?' — '+(co.nome_fantasia||co.razao_social):' — consolidado'))], [q('Descrição'),...head.map(q)] ];
  dreItems.forEach((it,i)=>out.push([q(it.titulo),...linhas[i].map(x=>x.pct!==undefined?(x.pct===null||!isFinite(x.pct)?'':num(x.pct)+'%'):num(x.n))]));
  const blob=new Blob(['\ufeff'+out.map(r=>r.join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`DRE_${dreView.per.titulo.replace(/[^\w×-]+/g,'_')}.csv`; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}

/* ---------- DRE: lançamentos sem categoria (classificar na hora) ---------- */
async function openSemCategoria(ini, fim){
  const [y,m]=fim.slice(0,7).split('-').map(Number), [ny,nm]=addMes(y,m,1), ate=`${ny}-${String(nm).padStart(2,'0')}-01`;
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal xl" style="max-width:860px"><div class="modal-h"><h2>Lançamentos sem categoria</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="loading">Carregando…</div></div></div></div>`;
  $('mx').onclick=closeModal;
  try{
    const q=(tab,tit,contra)=>scopeQ(db.from(tab).select(`valor,competencia,${tit}!inner(id,descricao,categoria_id,company_id,${contra}(razao_social,nome_fantasia))`))
      .is(`${tit}.categoria_id`,null).neq('status','cancelado').gte('competencia',ini).lt('competencia',ate).limit(1000);
    const [pag,rec]=await Promise.all([q('payable_installments','payables','suppliers'), q('receivable_installments','receivables','customers')]);
    if(pag.error) throw pag.error; if(rec.error) throw rec.error;
    const tit={};
    const add=(rows,key,tipo,contra)=>(rows||[]).forEach(r=>{ const t=r[key]; const x=tit[t.id]||(tit[t.id]={id:t.id,tipo,descricao:t.descricao,company_id:t.company_id,
      contra:t[contra]?(t[contra].nome_fantasia||t[contra].razao_social):'—',valor:0}); x.valor+=Number(r.valor); });
    add(pag.data,'payables','pagar','suppliers'); add(rec.data,'receivables','receber','customers');
    const lista=Object.values(tit).sort((a,b)=>b.valor-a.valor);
    if(!lista.length){ $('modalRoot').querySelector('.modal-b').innerHTML='<div class="empty">Nenhum lançamento sem categoria no período.</div>'; return; }
    const cos=[...new Set(lista.map(t=>t.company_id))];
    const { data:cats, error:ce }=await db.from('categories').select('id,nome,tipo,company_id,parent_id').in('company_id',cos).order('nome');
    if(ce) throw ce;
    const byId=Object.fromEntries((cats||[]).map(c=>[c.id,c]));
    const opcoes=t=>(cats||[]).filter(c=>c.company_id===t.company_id && c.tipo===(t.tipo==='pagar'?'despesa':'receita'))
      .map(c=>`<option value="${c.id}">${c.parent_id&&byId[c.parent_id]?esc(byId[c.parent_id].nome)+' › ':''}${esc(c.nome)}</option>`).join('');
    const escolha={};
    $('modalRoot').querySelector('.modal').innerHTML=`<div class="modal-h"><h2>Lançamentos sem categoria</h2><button class="x" id="mx">×</button></div>
      <div class="modal-b"><div class="box">Sem categoria o lançamento não entra na DRE. Escolha a categoria de cada um — vale pro título inteiro (todas as parcelas).</div>
      <div style="max-height:52vh;overflow-y:auto"><table><thead><tr><th>Tipo</th>${companyId?'':'<th>Empresa</th>'}<th>Descrição</th><th>Fornecedor / cliente</th><th class="r">Valor no período</th><th style="width:230px">Categoria</th></tr></thead><tbody>
      ${lista.map(t=>`<tr><td><span class="pill ${t.tipo==='pagar'?'st-a_pagar':'st-recebido'}">${t.tipo==='pagar'?'Pagar':'Receber'}</span></td>${companyId?'':`<td>${esc(coName(t.company_id))}</td>`}
        <td>${esc(t.descricao)}</td><td>${esc(t.contra)}</td><td class="r">${money(t.valor)}</td>
        <td><select data-sc="${t.id}"><option value="">— escolha —</option>${opcoes(t)}</select></td></tr>`).join('')}
      </tbody></table></div>${(pag.data||[]).length>=1000||(rec.data||[]).length>=1000?'<div class="hint">Mostrando os primeiros 1.000 de cada tipo.</div>':''}</div>
      <div class="modal-f"><span id="scRes" style="margin-right:auto;font-size:13px;color:var(--muted)">0 escolhida(s)</span><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar categorias</button></div>`;
    $('mx').onclick=$('mCancel').onclick=closeModal;
    $('modalRoot').querySelectorAll('[data-sc]').forEach(s=>s.onchange=()=>{ if(s.value) escolha[s.dataset.sc]=s.value; else delete escolha[s.dataset.sc]; $('scRes').textContent=Object.keys(escolha).length+' escolhida(s)'; });
    $('mSave').onclick=async ()=>{
      const ids=Object.keys(escolha); if(!ids.length){ toast('Escolha a categoria de pelo menos um lançamento.','err'); return; }
      $('mSave').disabled=true;
      const res=await Promise.all(ids.map(id=>db.from(tit[id].tipo==='pagar'?'payables':'receivables').update({categoria_id:escolha[id]}).eq('id',id)));
      const err=res.find(r=>r.error);
      if(err){ $('mSave').disabled=false; toast('Erro: '+err.error.message,'err'); return; }
      closeModal(); toast(ids.length+' lançamento(s) classificado(s).'); refreshDre();
    };
  }catch(err){ $('modalRoot').querySelector('.modal-b').innerHTML=`<div class="empty">Erro: ${esc(err.message||err)}</div>`; }
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
