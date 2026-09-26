/* ===================== CONTROLADORIA — ORÇAMENTO ===================== */
/* num() também é usado por Indicadores (metas) */
let orcState={co:'',ano:new Date().getFullYear(),budgetId:null,cats:[],items:{}};
const num=v=>{ const n=parseFloat(String(v).replace(',','.')); return isNaN(n)?0:n; };

async function renderOrcamento(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  orcState.co=defaultCo;
  $('main').innerHTML=`<div class="page-h"><h1>Orçamento</h1><div class="spacer"></div></div>
    <div class="updated">Orçado por categoria e mês (só categorias mapeadas na DRE). Edite direto nas células.</div>
    <div class="filters">
      <div class="fg"><label>Empresa</label><select id="ocCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="fg"><label>Ano</label><input id="ocAno" type="number" value="${orcState.ano}" style="max-width:110px"></div>
    </div>
    <div id="ocArea"><div class="loading">Carregando…</div></div>`;
  $('ocCo').onchange=e=>{ orcState.co=e.target.value; loadOrc(); };
  $('ocAno').onchange=e=>{ orcState.ano=+e.target.value||orcState.ano; loadOrc(); };
  await loadOrc();
}
async function loadOrc(){
  $('ocArea').innerHTML='<div class="loading">Carregando…</div>';
  try{
    const co=orcState.co, ano=orcState.ano;
    // garante orçamento do ano
    let { data:b }=await db.from('budgets').select('id').eq('company_id',co).eq('ano',ano).maybeSingle();
    if(!b){ const ins=await db.from('budgets').insert({company_id:co,ano,nome:'Orçamento '+ano}).select('id').single(); if(ins.error) throw ins.error; b=ins.data; }
    orcState.budgetId=b.id;
    // categorias mapeadas na DRE
    const [maps,cats,items]=await Promise.all([
      db.from('dre_category_mappings').select('categoria_id').eq('company_id',co),
      db.from('categories').select('id,nome,tipo').eq('company_id',co).order('tipo').order('nome'),
      db.from('budget_items').select('id,categoria_id,mes,valor_orcado').eq('company_id',co).eq('ano',ano),
    ]);
    const mapped=new Set((maps.data||[]).map(m=>m.categoria_id));
    orcState.cats=(cats.data||[]).filter(c=>mapped.has(c.id));
    orcState.items={}; (items.data||[]).forEach(it=>{ orcState.items[it.categoria_id+'_'+it.mes]={id:it.id,valor:Number(it.valor_orcado)}; });
    drawOrc();
  }catch(err){ $('ocArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
function drawOrc(){
  if(!orcState.cats.length){ $('ocArea').innerHTML='<div class="panel"><div class="empty">Nenhuma categoria mapeada para esta empresa.<br>Vá em <b>DRE → Mapear categorias</b> primeiro.</div></div>'; return; }
  const head=`<tr><th>Categoria</th>${MES3.map(m=>`<th>${m}</th>`).join('')}<th>Total</th></tr>`;
  const body=orcState.cats.map(c=>{
    const cells=MES3.map((_,mi)=>{ const it=orcState.items[c.id+'_'+(mi+1)]; const v=it?it.valor:'';
      return `<td><input data-cat="${c.id}" data-mes="${mi+1}" type="number" step="0.01" value="${v}"></td>`; }).join('');
    return `<tr><td>${esc(c.nome)}</td>${cells}<td class="rowtot" data-rowtot="${c.id}">R$ 0,00</td></tr>`;
  }).join('');
  const foot=`<tr><td>Total</td>${MES3.map((_,mi)=>`<td data-coltot="${mi+1}">R$ 0,00</td>`).join('')}<td data-grand>R$ 0,00</td></tr>`;
  $('ocArea').innerHTML=`<div class="panel" style="padding:14px"><div class="ocwrap"><table class="oc">
    <thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
    <div class="hint" style="margin-top:10px">Salva automaticamente ao sair da célula. Deixe em branco (ou 0) o que não for orçar.</div></div>`;
  const inputs=$('ocArea').querySelectorAll('input[data-cat]');
  inputs.forEach(inp=>{ inp.oninput=recalcOrc; inp.onchange=()=>saveOrcCell(inp.dataset.cat,+inp.dataset.mes,inp.value); });
  recalcOrc();
}
function recalcOrc(){
  const area=$('ocArea'); const cols=Array(13).fill(0); let grand=0;
  orcState.cats.forEach(c=>{
    let rt=0;
    for(let mi=1;mi<=12;mi++){ const inp=area.querySelector(`input[data-cat="${c.id}"][data-mes="${mi}"]`); const v=num(inp.value); rt+=v; cols[mi]+=v; }
    grand+=rt; const rtc=area.querySelector(`[data-rowtot="${c.id}"]`); if(rtc) rtc.textContent=money(rt);
  });
  for(let mi=1;mi<=12;mi++){ const c=area.querySelector(`[data-coltot="${mi}"]`); if(c) c.textContent=money(cols[mi]); }
  const g=area.querySelector('[data-grand]'); if(g) g.textContent=money(grand);
}
async function saveOrcCell(cat,mes,rawVal){
  const key=cat+'_'+mes; const existing=orcState.items[key];
  const val=rawVal===''?null:num(rawVal);
  try{
    if(val===null||val===0){
      if(existing){ await db.from('budget_items').delete().eq('id',existing.id); delete orcState.items[key]; }
      return;
    }
    if(existing){ const { error }=await db.from('budget_items').update({valor_orcado:val}).eq('id',existing.id); if(error) throw error; existing.valor=val; }
    else { const { data,error }=await db.from('budget_items').insert({budget_id:orcState.budgetId,company_id:orcState.co,ano:orcState.ano,mes,categoria_id:cat,valor_orcado:val}).select('id').single(); if(error) throw error; orcState.items[key]={id:data.id,valor:val}; }
  }catch(err){ toast('Erro ao salvar célula: '+(err.message||err),'err'); }
}