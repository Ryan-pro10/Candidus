/* ===================== CENTRAL DE PENDÊNCIAS ===================== */
/* PRIO e PRIO_ORDER também são usados por Tarefas e Documentos */
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