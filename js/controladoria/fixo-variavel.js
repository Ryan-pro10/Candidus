/* ===================== CUSTO FIXO × VARIÁVEL ===================== */
const COMP_LBL={fixo:'Fixo',variavel:'Variável'};
function compPill(c, herdado){
  if(!c) return '<span style="color:var(--muted)">não classificado</span>';
  return `<span class="pill ${c==='fixo'?'st-a_pagar':'st-recebido_parcial'}" ${herdado?'style="opacity:.6" title="Herdado da categoria-pai"':''}>${COMP_LBL[c]}${herdado?' (do pai)':''}</span>`;
}
async function openFixoVariavel(){
  const { data, error }=await scopeQ(db.from('categories').select('id,nome,parent_id,comportamento,company_id').eq('tipo','despesa')).order('nome');
  if(error){ toast('Erro: '+error.message,'err'); return; }
  const cats=data||[]; if(!cats.length){ toast('Nenhuma categoria de despesa.','err'); return; }
  const novo=Object.fromEntries(cats.map(c=>[c.id,c.comportamento||'']));
  const byId=Object.fromEntries(cats.map(c=>[c.id,c]));
  // pai seguido dos filhos
  const ordem=[]; cats.filter(c=>!c.parent_id||!byId[c.parent_id]).forEach(p=>{ ordem.push(p); cats.filter(c=>c.parent_id===p.id).forEach(f=>ordem.push(f)); });
  const efetivo=c=>novo[c.id]||(c.parent_id&&byId[c.parent_id]?novo[c.parent_id]:'')||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal xl" style="max-width:760px">
    <div class="modal-h"><h2>Custo fixo × variável</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box"><b>Variável</b> = acompanha o volume de vendas/serviços (insumos, comissões, frete, impostos sobre venda).
      <b>Fixo</b> = existe mesmo sem vender (aluguel, salários administrativos, contabilidade, sistemas).<br>
      Categoria filha em branco <b>herda do pai</b>. Isso alimenta a margem de contribuição e o ponto de equilíbrio nos Indicadores.</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center"><span id="fvResumo" style="font-size:13px;margin-right:auto"></span></div>
      <div style="max-height:52vh;overflow-y:auto"><table><thead><tr>${companyId?'':'<th>Empresa</th>'}<th>Categoria de despesa</th><th style="width:230px">Comportamento</th></tr></thead><tbody id="fvBody"></tbody></table></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const resumo=()=>{ const n=ordem.filter(c=>efetivo(c)).length; $('fvResumo').innerHTML=`<b>${n}</b> de ${ordem.length} categorias classificadas${n<ordem.length?` · <span style="color:var(--amber)">${ordem.length-n} sem classificação</span>`:' ✓'}`; };
  const draw=()=>{
    $('fvBody').innerHTML=ordem.map(c=>{ const filho=c.parent_id&&byId[c.parent_id]; const pai=filho?novo[c.parent_id]:'';
      return `<tr>${companyId?'':`<td>${esc(coName(c.company_id))}</td>`}<td>${filho?`&nbsp;&nbsp;↳ ${esc(c.nome)}`:`<b>${esc(c.nome)}</b>`}</td>
      <td><select data-fv="${c.id}">
        <option value="">${filho?(pai?`herda do pai (${COMP_LBL[pai]})`:'herda do pai (não classificado)'):'— não classificado —'}</option>
        <option value="fixo" ${novo[c.id]==='fixo'?'selected':''}>Fixo</option>
        <option value="variavel" ${novo[c.id]==='variavel'?'selected':''}>Variável</option></select></td></tr>`; }).join('');
    $('fvBody').querySelectorAll('[data-fv]').forEach(s=>s.onchange=()=>{ novo[s.dataset.fv]=s.value; const temFilhos=cats.some(c=>c.parent_id===s.dataset.fv); if(temFilhos) draw(); else resumo(); });
    resumo();
  };
  draw();
  $('mSave').onclick=async ()=>{
    const itens=cats.filter(c=>(c.comportamento||'')!==novo[c.id]).map(c=>({id:c.id, comportamento:novo[c.id]||null}));
    if(!itens.length){ closeModal(); return; }
    $('mSave').disabled=true;
    const { data:n, error }=await db.rpc('salvar_comportamento_categorias',{ p_itens:itens });
    if(error){ $('mSave').disabled=false; toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast(`${n} categoria(s) atualizada(s).`); if(typeof loadCategorias==='function' && $('catArea')) loadCategorias();
  };
}
// variáveis × fixos no período (custos e despesas operacionais da DRE)
// sem classificação: custo → variável, despesa operacional → fixo (estimativa)
function indCV(data, ini, fim){
  const r={variavel:0, fixo:0, semClass:0};
  data.forEach(d=>{ if(d.mes<ini||d.mes>fim||d.origem!=='pagar') return;
    if(d.natureza!=='custo'&&d.natureza!=='despesa_operacional') return;
    const v=Number(d.valor||0);
    if(d.comportamento==='variavel') r.variavel+=v;
    else if(d.comportamento==='fixo') r.fixo+=v;
    else { r.semClass+=v; if(d.natureza==='custo') r.variavel+=v; else r.fixo+=v; } });
  return r;
}
