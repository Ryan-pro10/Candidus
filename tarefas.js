/* ===================== TAREFAS ===================== */
const TSTATUS={a_fazer:'A fazer',em_andamento:'Em andamento',aguardando:'Aguardando',concluida:'Concluída',cancelada:'Cancelada'};
const REC={nenhuma:'Não repete',diaria:'Diária',semanal:'Semanal',quinzenal:'Quinzenal',mensal:'Mensal',trimestral:'Trimestral',anual:'Anual'};
let tarCache={tasks:[],chk:{},profiles:[],templates:[]};
let tarFilters={status:'',prioridade:'',resp:''};
const openTasks=new Set();
function addRec(d,rec){ const b=new Date((d||todayStr())+'T00:00:00');
  if(rec==='diaria')b.setDate(b.getDate()+1); else if(rec==='semanal')b.setDate(b.getDate()+7);
  else if(rec==='quinzenal')b.setDate(b.getDate()+15); else if(rec==='mensal')b.setMonth(b.getMonth()+1);
  else if(rec==='trimestral')b.setMonth(b.getMonth()+3); else if(rec==='anual')b.setMonth(b.getMonth()+12);
  return b.toISOString().slice(0,10); }

async function renderTarefas(){
  $('main').innerHTML=`<div class="page-h"><h1>Tarefas</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovaTar">+ Nova tarefa</button></div>
    <div class="updated">Com checklist e recorrência. Ao concluir uma tarefa recorrente, a próxima é criada automaticamente.</div>
    <div id="tarFilters"></div><div id="tarArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaTar').onclick=()=>openTarForm(null);
  await loadTarefas();
}
async function loadTarefas(){
  try{
    const [tks,chk,profs,tpls]=await Promise.all([
      scopeQ(db.from('tasks').select('*')),
      scopeQ(db.from('task_checklists').select('*')),
      db.from('profiles').select('id,nome,email'),
      db.from('task_templates').select('*'),
    ]);
    if(tks.error) throw tks.error; if(chk.error) throw chk.error;
    const byT={}; (chk.data||[]).forEach(c=>{(byT[c.task_id]=byT[c.task_id]||[]).push(c);});
    Object.values(byT).forEach(a=>a.sort((x,y)=>x.ordem-y.ordem));
    tarCache={tasks:tks.data||[],chk:byT,profiles:profs.data||[],templates:tpls.data||[]};
    renderTarFilters(); drawTarefas();
  }catch(err){ $('tarArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
function tProf(id){ const p=tarCache.profiles.find(x=>x.id===id); return p?(p.nome||p.email):'—'; }
function renderTarFilters(){
  $('tarFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Status</label><select id="tfSt"><option value="">Todos</option>${Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${tarFilters.status===k?'selected':''}>${v}</option>`).join('')}<option value="atrasada" ${tarFilters.status==='atrasada'?'selected':''}>Atrasadas</option></select></div>
    <div class="fg"><label>Prioridade</label><select id="tfPr"><option value="">Todas</option>${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${tarFilters.prioridade===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Responsável</label><select id="tfRe"><option value="">Todos</option>${tarCache.profiles.map(p=>`<option value="${p.id}" ${tarFilters.resp===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
  </div>`;
  $('tfSt').onchange=e=>{tarFilters.status=e.target.value;drawTarefas();};
  $('tfPr').onchange=e=>{tarFilters.prioridade=e.target.value;drawTarefas();};
  $('tfRe').onchange=e=>{tarFilters.resp=e.target.value;drawTarefas();};
}
const isAtrasada=t=>t.prazo && t.prazo<todayStr() && !['concluida','cancelada'].includes(t.status);
function drawTarefas(){
  let rows=tarCache.tasks.slice();
  if(tarFilters.status==='atrasada') rows=rows.filter(isAtrasada);
  else if(tarFilters.status) rows=rows.filter(t=>t.status===tarFilters.status);
  if(tarFilters.prioridade) rows=rows.filter(t=>t.prioridade===tarFilters.prioridade);
  if(tarFilters.resp) rows=rows.filter(t=>t.assigned_user_id===tarFilters.resp);
  rows.sort((a,b)=>(PRIO_ORDER[a.prioridade]-PRIO_ORDER[b.prioridade])||((a.prazo||'9999').localeCompare(b.prazo||'9999')));
  if(!rows.length){ $('tarArea').innerHTML='<div class="panel"><div class="empty">Nenhuma tarefa. Clique em “+ Nova tarefa”.</div></div>'; return; }
  const showCo=!companyId;
  const stOpts=t=>Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('');
  const body=rows.map((t,i)=>{
    const open=openTasks.has(t.id);
    const items=tarCache.chk[t.id]||[];
    const done=items.filter(c=>c.done).length;
    const prog=items.length?`${done}/${items.length}`:'—';
    const atras=isAtrasada(t)?' <span class="pill st-vencido">atrasada</span>':'';
    const rec=t.recorrencia&&t.recorrencia!=='nenhuma'?` <span class="pill ps-em_andamento" style="font-size:9px">${REC[t.recorrencia]}</span>`:'';
    const main=`<tr class="title-row" data-i="${i}">
      <td><span class="caret ${open?'open':''}">▶</span><span class="pill pr-${t.prioridade}">${PRIO[t.prioridade]}</span></td>
      <td><b>${esc(t.titulo)}</b>${rec}${t.categoria?`<br><span style="font-size:12px;color:var(--muted)">${esc(t.categoria)}</span>`:''}</td>
      ${showCo?`<td>${esc(coName(t.company_id))}</td>`:''}
      <td>${esc(tProf(t.assigned_user_id))}</td>
      <td>${t.prazo?fmtDate(t.prazo):'—'}${atras}</td>
      <td>${prog}</td>
      <td><select class="stsel" data-st="${t.id}">${stOpts(t)}</select></td>
      <td><div class="act"><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`;
    let det='';
    if(open){
      const chkHtml=items.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0">
        <input type="checkbox" data-chk="${c.id}" ${c.done?'checked':''} style="width:16px;height:16px">
        <span style="flex:1;font-size:13px;${c.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(c.descricao)}</span>
        <button class="lnk del" data-chkdel="${c.id}" style="padding:2px 8px">×</button></div>`).join('') || '<div style="color:var(--muted);font-size:13px;padding:4px 0">Sem itens no checklist.</div>';
      det=`<tr><td colspan="${showCo?8:7}" style="background:#f8fafb">
        <div style="padding:6px 8px 12px 38px">
          <div style="font-size:12px;font-weight:600;color:var(--ink);margin-bottom:6px">Checklist</div>
          ${chkHtml}
          <div style="display:flex;gap:8px;margin-top:8px;max-width:460px">
            <input id="chkNew_${t.id}" placeholder="Novo item do checklist" style="flex:1;padding:7px 10px;font-size:13px">
            <button class="mini" data-chkadd="${t.id}">Adicionar</button>
          </div>
          ${t.descricao?`<div style="margin-top:10px;font-size:12.5px;color:var(--muted)"><b>Descrição:</b> ${esc(t.descricao)}</div>`:''}
          ${t.completed_at?`<div style="margin-top:6px;font-size:12px;color:var(--green)">Concluída em ${fmtDate(t.completed_at.slice(0,10))} por ${esc(tProf(t.completed_by))}</div>`:''}
        </div></td></tr>`;
    }
    return main+det;
  }).join('');
  $('tarArea').innerHTML=`<div class="panel"><table><thead><tr>
    <th>Prioridade</th><th>Tarefa</th>${showCo?'<th>Empresa</th>':''}<th>Responsável</th><th>Prazo</th><th>Checklist</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  $('tarArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=e=>{
    if(e.target.closest('select,button')) return;
    const t=rows[+tr.dataset.i]; openTasks.has(t.id)?openTasks.delete(t.id):openTasks.add(t.id); drawTarefas();
  });
  $('tarArea').querySelectorAll('[data-st]').forEach(s=>s.onclick=e=>e.stopPropagation());
  $('tarArea').querySelectorAll('[data-st]').forEach(s=>s.onchange=()=>changeTaskStatus(s.dataset.st,s.value));
  $('tarArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openTarForm(rows[+b.dataset.edit]);});
  $('tarArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();delTarefa(rows[+b.dataset.del]);});
  $('tarArea').querySelectorAll('[data-chk]').forEach(c=>c.onchange=()=>toggleChk(c.dataset.chk,c.checked));
  $('tarArea').querySelectorAll('[data-chkdel]').forEach(b=>b.onclick=()=>delChk(b.dataset.chkdel));
  $('tarArea').querySelectorAll('[data-chkadd]').forEach(b=>b.onclick=()=>addChk(b.dataset.chkadd));
}
async function changeTaskStatus(id,status){
  const t=tarCache.tasks.find(x=>x.id===id); if(!t) return;
  const patch={status};
  if(status==='concluida'){ patch.completed_at=new Date().toISOString(); patch.completed_by=userId; }
  const { error }=await db.from('tasks').update(patch).eq('id',id);
  if(error){ toast('Erro ao atualizar.','err'); return; }
  if(status==='concluida' && t.recorrencia && t.recorrencia!=='nenhuma') await gerarProximaTarefa(t);
  toast('Status atualizado.'); loadTarefas();
}
async function gerarProximaTarefa(t){
  const novo={ company_id:t.company_id, titulo:t.titulo, descricao:t.descricao, categoria:t.categoria,
    assigned_user_id:t.assigned_user_id, prioridade:t.prioridade, recorrencia:t.recorrencia,
    recurrence_parent_id:t.recurrence_parent_id||t.id, status:'a_fazer',
    data_inicial: t.data_inicial?addRec(t.data_inicial,t.recorrencia):null,
    prazo: t.prazo?addRec(t.prazo,t.recorrencia):null };
  const { data,error }=await db.from('tasks').insert(novo).select('id').single();
  if(error||!data) return;
  const items=tarCache.chk[t.id]||[];
  if(items.length){
    const copies=items.map(c=>({task_id:data.id,company_id:t.company_id,descricao:c.descricao,done:false,ordem:c.ordem}));
    await db.from('task_checklists').insert(copies);
  }
  toast('Próxima tarefa recorrente criada.');
}
async function toggleChk(id,done){ const { error }=await db.from('task_checklists').update({done}).eq('id',id); if(error){toast('Erro.','err');return;} loadTarefas(); }
async function delChk(id){ const { error }=await db.from('task_checklists').delete().eq('id',id); if(error){toast('Erro.','err');return;} loadTarefas(); }
async function addChk(taskId){
  const inp=$('chkNew_'+taskId); const desc=(inp&&inp.value||'').trim(); if(!desc){toast('Digite o item.','err');return;}
  const t=tarCache.tasks.find(x=>x.id===taskId); const ordem=(tarCache.chk[taskId]||[]).length;
  const { error }=await db.from('task_checklists').insert({task_id:taskId,company_id:t.company_id,descricao:desc,ordem});
  if(error){toast('Erro ao adicionar.','err');return;} loadTarefas();
}
function openTarForm(rec){
  const creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field"><label>Empresa *</label><select id="taCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  const tplField=creating?`<div class="field" style="grid-column:1/3"><label>Carregar modelo de checklist (opcional)</label><select id="taTpl"><option value="">— nenhum —</option>${tarCache.templates.map(t=>`<option value="${t.id}">${esc(t.nome)} (${(t.itens||[]).length} itens)</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} tarefa</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      ${coField}
      <div class="field"><label>Categoria</label><input id="taCat" value="${esc(rec?rec.categoria:'')}" placeholder="ex: Financeiro"></div>
      <div class="field" style="grid-column:1/3"><label>Título *</label><input id="taTit" value="${esc(rec?rec.titulo:'')}"></div>
      <div class="field" style="grid-column:1/3"><label>Descrição</label><textarea id="taDesc" rows="2">${esc(rec?rec.descricao:'')}</textarea></div>
      <div class="field"><label>Responsável</label><select id="taResp"><option value="">—</option>${tarCache.profiles.map(p=>`<option value="${p.id}" ${rec&&rec.assigned_user_id===p.id?'selected':''}>${esc(p.nome||p.email)}</option>`).join('')}</select></div>
      <div class="field"><label>Prioridade</label><select id="taPrio">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${(rec?rec.prioridade:'media')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Data inicial</label><input id="taIni" type="date" value="${rec&&rec.data_inicial?rec.data_inicial:''}"></div>
      <div class="field"><label>Prazo</label><input id="taPrazo" type="date" value="${rec&&rec.prazo?rec.prazo:''}"></div>
      <div class="field"><label>Recorrência</label><select id="taRec">${Object.entries(REC).map(([k,v])=>`<option value="${k}" ${(rec?rec.recorrencia:'nenhuma')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select id="taSt">${Object.entries(TSTATUS).map(([k,v])=>`<option value="${k}" ${(rec?rec.status:'a_fazer')===k?'selected':''}>${v}</option>`).join('')}</select></div>
      ${tplField}
    </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const titulo=$('taTit').value.trim(); if(!titulo){toast('Informe o título.','err');return;}
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ titulo, descricao:$('taDesc').value||null, categoria:$('taCat').value||null,
      assigned_user_id:$('taResp').value||null, prioridade:$('taPrio').value,
      data_inicial:$('taIni').value||null, prazo:$('taPrazo').value||null,
      recorrencia:$('taRec').value, status:$('taSt').value };
    let res, taskId;
    if(creating){ payload.company_id=$('taCo').value; res=await db.from('tasks').insert(payload).select('id').single(); taskId=res.data&&res.data.id; }
    else { res=await db.from('tasks').update(payload).eq('id',rec.id); taskId=rec.id; }
    if(res.error){ $('mSave').disabled=false; $('mSave').textContent='Salvar'; toast('Erro: '+res.error.message,'err'); return; }
    // modelo de checklist
    if(creating){ const tplId=$('taTpl').value; if(tplId){ const tpl=tarCache.templates.find(t=>t.id===tplId);
      if(tpl && (tpl.itens||[]).length){ const items=tpl.itens.map((d,idx)=>({task_id:taskId,company_id:payload.company_id,descricao:d,ordem:idx})); await db.from('task_checklists').insert(items); } } }
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    closeModal(); toast('Tarefa '+(creating?'criada!':'atualizada!')); loadTarefas();
  };
}
async function delTarefa(rec){
  const ok=await confirmModal({titulo:'Excluir tarefa',texto:`Excluir “${rec.titulo}”? O checklist também será removido.`,ok:'Excluir',perigo:true});
  if(!ok) return;
  const { error }=await db.from('tasks').delete().eq('id',rec.id);
  if(error){ toast('Erro ao excluir.','err'); return; }
  toast('Excluída.'); loadTarefas();
}