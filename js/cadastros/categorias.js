/* ===================== undefined ===================== */
/* ---------- CATEGORIAS (hierárquicas) ---------- */
let catRows=[];
async function renderCategorias(){
  $('main').innerHTML=`<div class="page-h"><h1>Categorias</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnFV">Fixo × variável</button><button class="btn" id="btnNovaCat">+ Nova categoria</button></div></div>
    <div class="updated">Receitas e despesas. Pode ter categoria-pai (hierarquia).</div>
    <div id="catArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaCat').onclick=()=>openCatForm(null);
  $('btnFV').onclick=openFixoVariavel;
  await loadCategorias();
}
async function loadCategorias(){
  const { data,error }=await scopeQ(db.from('categories').select('*, cc_padrao:cost_centers!categories_default_cost_center_id_fkey(nome)')).order('nome',{ascending:true});
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
    const ids=new Set(rows.map(r=>r.id)), ordered=[];
    rows.filter(r=>!r.parent_id||!ids.has(r.parent_id)).forEach(p=>{ ordered.push(p); rows.filter(r=>r.parent_id===p.id).forEach(f=>ordered.push(f)); });
    const compById=Object.fromEntries(rows.map(r=>[r.id,r.comportamento]));
    const body=ordered.map(c=>{
      const idx=catRows.indexOf(c);
      const nome=c.parent_id?`&nbsp;&nbsp;↳ ${esc(c.nome)}`:`<b>${esc(c.nome)}</b>`;
      return `<tr>${showCo?`<td>${esc(coName(c.company_id))}</td>`:''}<td>${nome}</td><td>${c.parent_id?esc(nameById[c.parent_id]||'—'):'—'}</td><td>${c.cc_padrao?esc(c.cc_padrao.nome):'<span style="color:var(--muted)">—</span>'}</td>${tipo==='despesa'?`<td>${compPill(c.comportamento||compById[c.parent_id], !c.comportamento&&!!compById[c.parent_id])}</td>`:''}
        <td><div class="act"><button class="lnk" data-edit="${idx}">Editar</button><button class="lnk del" data-del="${idx}">Excluir</button></div></td></tr>`;
    }).join('');
    return `<div class="panel" style="margin-bottom:16px"><h3><span class="dot ${tipo==='receita'?'g':'r'}"></span>${tipo==='receita'?'Receitas':'Despesas'}</h3>
      <table><thead><tr>${showCo?'<th>Empresa</th>':''}<th>Categoria</th><th>Categoria-pai</th><th>Centro de custo padrão</th>${tipo==='despesa'?'<th>Fixo / variável</th>':''}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
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
      <div class="field" id="catCompWrap"><label>Custo fixo ou variável</label><select id="catComp">
        <option value="">— não classificado / herda do pai —</option>
        <option value="fixo" ${rec&&rec.comportamento==='fixo'?'selected':''}>Fixo (existe mesmo sem vender)</option>
        <option value="variavel" ${rec&&rec.comportamento==='variavel'?'selected':''}>Variável (acompanha as vendas)</option></select></div>
      <div class="field"><label>Categoria-pai (opcional)</label><select id="catPai"><option value="">— nenhuma —</option></select></div>
      <div class="field"><label>Centro de custo padrão (opcional)</label><select id="catCC"><option value="">— nenhum —</option></select>
        <div class="hint" style="margin-top:4px">Vem preenchido sozinho nos lançamentos desta categoria (dá pra trocar).</div></div>
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
  async function fillCC(){
    const { data }=await db.from('cost_centers').select('id,nome').eq('company_id',co()).order('nome');
    const sel=rec?rec.default_cost_center_id:null;
    $('catCC').innerHTML='<option value="">— nenhum —</option>'+(data||[]).map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.nome)}</option>`).join('');
  }
  fillPai(); fillCC();
  const compVis=()=>{ $('catCompWrap').style.display=$('catTipo').value==='despesa'?'':'none'; };
  compVis();
  $('catTipo').onchange=()=>{ fillPai(); compVis(); };
  if(creating) $('catCo').onchange=()=>{ fillPai(); fillCC(); };
  $('mSave').onclick=async ()=>{
    const nome=$('catNome').value.trim();
    if(!nome){ toast('Informe o nome.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ nome, tipo:$('catTipo').value, parent_id:$('catPai').value||null, default_cost_center_id:$('catCC').value||null, comportamento:$('catTipo').value==='despesa'?($('catComp').value||null):null };
    let res;
    if(creating){ payload.company_id=$('catCo').value; res=await db.from('categories').insert(payload); }
    else res=await db.from('categories').update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    limparCCPadraoCache(); closeModal(); toast('Categoria '+(creating?'criada!':'atualizada!')); loadCategorias();
  };
}
async function delCat(rec){
  const ok=await confirmModal({titulo:'Excluir categoria', texto:`Deseja excluir a categoria “${rec.nome}”?`, ok:'Excluir', perigo:true});
  if(!ok) return;
  const { error }=await db.from('categories').delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir (pode estar em uso).','err'); return; }
  toast('Excluída.'); loadCategorias();
}
