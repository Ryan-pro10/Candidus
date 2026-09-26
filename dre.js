/* ===================== CONTROLADORIA — DRE ===================== */
/* MESNOME e loadDreBase também são usados por R x O e Indicadores */
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