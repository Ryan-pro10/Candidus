/* ===================== DOCUMENTOS ===================== */
const DSTATUS={pendente:'Pendente',solicitado:'Solicitado',recebido:'Recebido',conferido:'Conferido',rejeitado:'Rejeitado'};
const DSTCLS={pendente:'ps-aberta',solicitado:'ps-aguardando_cliente',recebido:'ps-em_andamento',conferido:'ps-resolvida',rejeitado:'ps-cancelada'};
let docCache={docs:[],reqs:[],profiles:[]};
let docFilters={status:'',busca:''};

async function uploadDoc(companyId,file){
  const safe=file.name.replace(/[^\w.\-]/g,'_');
  const path=`${companyId}/${Date.now()}_${safe}`;
  const { error }=await db.storage.from('documentos').upload(path,file);
  if(error) throw error; return path;
}
async function abrirDoc(path){
  const { data,error }=await db.storage.from('documentos').createSignedUrl(path,120);
  if(error){ toast('Erro ao gerar link.','err'); return; }
  window.open(data.signedUrl,'_blank');
}

async function renderDocumentos(){
  $('main').innerHTML=`<div class="page-h"><h1>Documentos</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="btnSolic">Solicitar documento</button><button class="btn" id="btnEnviar">+ Enviar documento</button></div></div>
    <div class="updated">Arquivos guardados com segurança (bucket privado, isolados por empresa).</div>
    <div id="docReqs"></div><div id="docFilters"></div><div id="docArea"><div class="loading">Carregando…</div></div>`;
  $('btnEnviar').onclick=()=>openDocForm(null);
  $('btnSolic').onclick=openDocSolicitar;
  await loadDocs();
}
async function loadDocs(){
  try{
    const [docs,reqs,profs]=await Promise.all([
      scopeQ(db.from('documents').select('*, customers(razao_social,nome_fantasia), suppliers(razao_social,nome_fantasia)')).order('created_at',{ascending:false}),
      scopeQ(db.from('document_requests').select('*')).order('created_at',{ascending:false}),
      db.from('profiles').select('id,nome,email'),
    ]);
    if(docs.error) throw docs.error;
    docCache={docs:docs.data||[],reqs:reqs.data||[],profiles:profs.data||[]};
    drawDocReqs(); renderDocFilters(); drawDocs();
  }catch(err){ $('docArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
function dProf(id){ const p=docCache.profiles.find(x=>x.id===id); return p?(p.nome||p.email):'—'; }
function drawDocReqs(){
  const reqs=docCache.reqs.filter(r=>r.status==='solicitado');
  if(!reqs.length){ $('docReqs').innerHTML=''; return; }
  $('docReqs').innerHTML=`<div class="panel" style="margin-bottom:16px"><h3><span class="dot a"></span>Solicitações em aberto (${reqs.length})</h3>
    <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Competência</th><th>Responsável</th><th>Prazo</th><th></th></tr></thead>
    <tbody>${reqs.map((r,i)=>`<tr><td><b>${esc(r.descricao)}</b></td><td>${esc(r.tipo_documento||'—')}</td>
      <td>${r.competencia?fmtDate(r.competencia):'—'}</td><td>${esc(dProf(r.assigned_user_id))}</td><td>${r.prazo?fmtDate(r.prazo):'—'}</td>
      <td><div class="act"><button class="lnk" data-anexar="${i}">Anexar</button><button class="lnk" data-reqok="${i}">Marcar recebido</button></div></td></tr>`).join('')}</tbody></table></div>`;
  $('docReqs').querySelectorAll('[data-anexar]').forEach(b=>b.onclick=()=>openDocForm(null, reqs[+b.dataset.anexar]));
  $('docReqs').querySelectorAll('[data-reqok]').forEach(b=>b.onclick=()=>marcarReqRecebido(reqs[+b.dataset.reqok]));
}
async function marcarReqRecebido(req){
  const { error }=await db.from('document_requests').update({status:'recebido'}).eq('id',req.id);
  if(error){ toast('Erro.','err'); return; } toast('Solicitação marcada como recebida.'); loadDocs();
}
function renderDocFilters(){
  $('docFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Status</label><select id="dfSt"><option value="">Todos</option>${Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${docFilters.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fg"><label>Buscar</label><input id="dfB" placeholder="nome do documento" value="${esc(docFilters.busca)}"></div>
  </div>`;
  $('dfSt').onchange=e=>{docFilters.status=e.target.value;drawDocs();};
  $('dfB').oninput=e=>{docFilters.busca=e.target.value;drawDocs();};
}
function drawDocs(){
  let rows=docCache.docs.slice();
  if(docFilters.status) rows=rows.filter(d=>d.status===docFilters.status);
  if(docFilters.busca) rows=rows.filter(d=>(d.nome||'').toLowerCase().includes(docFilters.busca.toLowerCase()));
  if(!rows.length){ $('docArea').innerHTML='<div class="panel"><div class="empty">Nenhum documento. Clique em “+ Enviar documento”.</div></div>'; return; }
  const showCo=!companyId;
  const vinc=d=>{ const c=d.customers&&(d.customers.nome_fantasia||d.customers.razao_social); const s=d.suppliers&&(d.suppliers.nome_fantasia||d.suppliers.razao_social); return c?('Cliente: '+c):(s?('Forn.: '+s):'—'); };
  const stOpts=d=>Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${d.status===k?'selected':''}>${v}</option>`).join('');
  const body=rows.map((d,i)=>`<tr>
    <td><b>${esc(d.nome)}</b>${d.tipo?`<br><span style="font-size:12px;color:var(--muted)">${esc(d.tipo)}</span>`:''}</td>
    ${showCo?`<td>${esc(coName(d.company_id))}</td>`:''}
    <td>${esc(vinc(d))}</td>
    <td>${d.competencia?fmtDate(d.competencia):'—'}</td>
    <td><select class="stsel ${DSTCLS[d.status]}" data-st="${d.id}">${stOpts(d)}</select></td>
    <td><div class="act">${d.storage_path?`<button class="lnk" data-open="${i}">Baixar</button>`:''}<button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('docArea').innerHTML=`<div class="panel"><table><thead><tr><th>Documento</th>${showCo?'<th>Empresa</th>':''}<th>Vínculo</th><th>Competência</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('docArea').querySelectorAll('[data-st]').forEach(s=>s.onchange=()=>updateDocStatus(s.dataset.st,s.value));
  $('docArea').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>abrirDoc(rows[+b.dataset.open].storage_path));
  $('docArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openDocForm(rows[+b.dataset.edit]));
  $('docArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delDoc(rows[+b.dataset.del]));
}
async function updateDocStatus(id,status){
  const { error }=await db.from('documents').update({status}).eq('id',id);
  if(error){ toast('Erro.','err'); return; } toast('Status atualizado.'); loadDocs();
}
async function fillDocSelects(co){
  if(!co) return;
  const [cli,forn,acc,cat]=await Promise.all([
    db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
    db.from('categories').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl,sel)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}" ${sel===x.id?'selected':''}>${esc(lbl(x))}</option>`).join('');
  return {cli,forn,acc,cat,opt};
}
async function openDocForm(rec, req){
  const creating=!rec;
  const defaultCo=(req&&req.company_id)||(rec&&rec.company_id)||companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Enviar':'Editar'} documento</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      <div class="field"><label>Empresa *</label><select id="doCo" ${creating?'':'disabled'}>${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo</label><input id="doTipo" value="${esc(rec?rec.tipo:(req?req.tipo_documento||'':''))}" placeholder="NF, contrato, boleto…"></div>
      <div class="field" style="grid-column:1/3"><label>Nome do documento *</label><input id="doNome" value="${esc(rec?rec.nome:(req?req.descricao:''))}" placeholder="ex: NF 123 - Fornecedor X"></div>
      ${creating?`<div class="field" style="grid-column:1/3"><label>Arquivo</label><input id="doFile" type="file"><div class="hint">Opcional. Sem arquivo, o documento fica como pendente/solicitado.</div></div>`:''}
      <div class="field"><label>Data</label><input id="doData" type="date" value="${rec&&rec.data?rec.data:''}"></div>
      <div class="field"><label>Competência</label><input id="doComp" type="date" value="${rec&&rec.competencia?rec.competencia:(req&&req.competencia?req.competencia:'')}"></div>
      <div class="field"><label>Cliente</label><select id="doCli"><option value="">—</option></select></div>
      <div class="field"><label>Fornecedor</label><select id="doForn"><option value="">—</option></select></div>
      <div class="field"><label>Conta financeira</label><select id="doAcc"><option value="">—</option></select></div>
      <div class="field"><label>Categoria</label><select id="doCat"><option value="">—</option></select></div>
      <div class="field"><label>Status</label><select id="doSt">${Object.entries(DSTATUS).map(([k,v])=>`<option value="${k}" ${(rec?rec.status:(req?'recebido':'recebido'))===k?'selected':''}>${v}</option>`).join('')}</select></div>
    </div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  async function loadSel(co){ const s=await fillDocSelects(co); if(!s)return;
    $('doCli').innerHTML=s.opt(s.cli,x=>x.nome_fantasia||x.razao_social, rec?rec.customer_id:null);
    $('doForn').innerHTML=s.opt(s.forn,x=>x.nome_fantasia||x.razao_social, rec?rec.supplier_id:null);
    $('doAcc').innerHTML=s.opt(s.acc,x=>x.nome, rec?rec.financial_account_id:null);
    $('doCat').innerHTML=s.opt(s.cat,x=>x.nome, rec?rec.categoria_id:null);
  }
  await loadSel(defaultCo);
  if(creating) $('doCo').onchange=()=>loadSel($('doCo').value);
  $('mSave').onclick=async ()=>{
    const nome=$('doNome').value.trim(); if(!nome){toast('Informe o nome.','err');return;}
    const co=creating?$('doCo').value:rec.company_id;
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    try{
      let storage_path=rec?rec.storage_path:null;
      if(creating){ const f=$('doFile').files[0]; if(f) storage_path=await uploadDoc(co,f); }
      const payload={ nome, tipo:$('doTipo').value||null, data:$('doData').value||null, competencia:$('doComp').value||null,
        customer_id:$('doCli').value||null, supplier_id:$('doForn').value||null,
        financial_account_id:$('doAcc').value||null, categoria_id:$('doCat').value||null,
        status:$('doSt').value, storage_path };
      let res, docId;
      if(creating){ payload.company_id=co; res=await db.from('documents').insert(payload).select('id').single(); docId=res.data&&res.data.id; }
      else res=await db.from('documents').update(payload).eq('id',rec.id);
      if(res.error) throw res.error;
      if(req && docId){ await db.from('document_requests').update({status:'recebido',document_id:docId}).eq('id',req.id); }
      closeModal(); toast('Documento salvo!'); loadDocs();
    }catch(err){ toast('Erro: '+(err.message||err),'err'); }
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
  };
}
async function delDoc(rec){
  const ok=await confirmModal({titulo:'Excluir documento',texto:`Excluir “${rec.nome}”? O arquivo também será removido.`,ok:'Excluir',perigo:true});
  if(!ok) return;
  if(rec.storage_path){ await db.storage.from('documentos').remove([rec.storage_path]); }
  const { error }=await db.from('documents').delete().eq('id',rec.id);
  if(error){ toast('Erro ao excluir.','err'); return; } toast('Excluído.'); loadDocs();
}
function openDocSolicitar(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Solicitar documento</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      <div class="field"><label>Empresa *</label><select id="srCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo de documento</label><input id="srTipo" placeholder="NF, comprovante…"></div>
      <div class="field" style="grid-column:1/3"><label>Descrição *</label><input id="srDesc" placeholder="ex: NF de setembro do fornecedor X"></div>
      <div class="field"><label>Responsável</label><select id="srResp"><option value="">—</option>${docCache.profiles.map(p=>`<option value="${p.id}">${esc(p.nome||p.email)}</option>`).join('')}</select></div>
      <div class="field"><label>Prioridade</label><select id="srPrio">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${k==='media'?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Competência</label><input id="srComp" type="date"></div>
      <div class="field"><label>Prazo</label><input id="srPrazo" type="date"></div>
    </div><div class="hint" style="margin-top:8px">Ao solicitar, uma pendência do tipo “Documento” é criada automaticamente.</div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Solicitar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const desc=$('srDesc').value.trim(); if(!desc){toast('Informe a descrição.','err');return;}
    const co=$('srCo').value;
    $('mSave').disabled=true; $('mSave').textContent='Solicitando…';
    const req={ company_id:co, descricao:desc, tipo_documento:$('srTipo').value||null,
      assigned_user_id:$('srResp').value||null, competencia:$('srComp').value||null,
      prazo:$('srPrazo').value||null, prioridade:$('srPrio').value, status:'solicitado' };
    const r1=await db.from('document_requests').insert(req);
    if(r1.error){ $('mSave').disabled=false; $('mSave').textContent='Solicitar'; toast('Erro: '+r1.error.message,'err'); return; }
    await db.from('pending_items').insert({ company_id:co, tipo:'documento', titulo:'Documento solicitado: '+desc,
      descricao:$('srTipo').value||null, prioridade:$('srPrio').value, assigned_user_id:$('srResp').value||null,
      prazo:$('srPrazo').value||null, status:'aberta', origem:'manual' });
    $('mSave').disabled=false; $('mSave').textContent='Solicitar';
    closeModal(); toast('Documento solicitado e pendência criada!'); loadDocs();
  };
}