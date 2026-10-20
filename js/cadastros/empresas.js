/* ===================== CADASTRO DE EMPRESAS + ACESSO ===================== */
const EMP_FIELDS=[
  {k:'razao_social',l:'Razão social',req:true,col:2},
  {k:'nome_fantasia',l:'Nome fantasia'},{k:'cnpj',l:'CNPJ'},
  {k:'inscricao_estadual',l:'Inscrição estadual'},{k:'email',l:'E-mail'},
  {k:'telefone',l:'Telefone'},{k:'cep',l:'CEP'},
  {k:'endereco',l:'Endereço',col:2},{k:'numero',l:'Número'},{k:'complemento',l:'Complemento'},
  {k:'bairro',l:'Bairro'},{k:'cidade',l:'Cidade'},{k:'estado',l:'UF'},
  {k:'status',l:'Status',type:'select',opts:[['ativo','Ativo'],['inativo','Inativo']],def:'ativo'},
];
let empRows=[];
async function renderEmpresas(){
  $('main').innerHTML=`<div class="page-h"><h1>Empresas</h1><div class="spacer"></div>
    <button class="btn" id="btnNovaEmp">+ Nova empresa</button></div>
    <div class="updated">Cadastre suas empresas e defina quais usuários têm acesso a cada uma.</div>
    <div id="empArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaEmp').onclick=()=>openEmpForm(null);
  await loadEmpresas();
}
async function loadEmpresas(){
  const { data,error }=await db.from('companies').select('*').order('razao_social');
  if(error){ $('empArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  empRows=data||[]; drawEmpresas();
}
function drawEmpresas(){
  if(!empRows.length){ $('empArea').innerHTML='<div class="panel"><div class="empty">Nenhuma empresa. Clique em “+ Nova empresa”.</div></div>'; return; }
  const body=empRows.map((c,i)=>`<tr>
    <td><b>${esc(c.nome_fantasia||c.razao_social)}</b>${c.nome_fantasia?`<br><span style="font-size:12px;color:var(--muted)">${esc(c.razao_social)}</span>`:''}</td>
    <td>${esc(c.cnpj||'—')}</td>
    <td>${esc([c.cidade,c.estado].filter(Boolean).join('/')||'—')}</td>
    <td>${statusPill(c.status)}</td>
    <td><div class="act"><button class="lnk" data-users="${i}">Usuários</button><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('empArea').innerHTML=`<div class="panel"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Cidade/UF</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('empArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEmpForm(empRows[+b.dataset.edit]));
  $('empArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delEmpresa(empRows[+b.dataset.del]));
  $('empArea').querySelectorAll('[data-users]').forEach(b=>b.onclick=()=>openEmpUsers(empRows[+b.dataset.users]));
}
function openEmpForm(rec){
  const creating=!rec;
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} empresa</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">${EMP_FIELDS.map(f=>cadFieldHTML(f,rec?rec[f.k]:null)).join('')}</div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const payload={};
    document.querySelectorAll('#modalRoot [data-k]').forEach(inp=>{ payload[inp.dataset.k]=(inp.value===''?null:inp.value); });
    if(!payload.razao_social){ toast('Informe a razão social.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    let res;
    if(creating) res=await db.from('companies').insert(payload);
    else res=await db.from('companies').update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast('Empresa '+(creating?'criada!':'atualizada!'));
    await loadCompanies();   // atualiza o seletor do topo
    loadEmpresas();
  };
}
async function delEmpresa(rec){
  const ok=await confirmModal({titulo:'Excluir empresa',texto:`Excluir “${rec.nome_fantasia||rec.razao_social}”? Só é possível se a empresa não tiver lançamentos/cadastros.`,ok:'Excluir',perigo:true});
  if(!ok) return;
  const { error }=await db.from('companies').delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir: a empresa tem dados vinculados.','err'); return; }
  toast('Empresa excluída.'); await loadCompanies(); loadEmpresas();
}
async function openEmpUsers(emp){
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Acesso — ${esc(emp.nome_fantasia||emp.razao_social)}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="hint" style="margin-bottom:10px">Marque quem pode acessar esta empresa. (Administradores já enxergam todas.)</div><div id="euArea"><div class="loading">Carregando…</div></div></div>
    <div class="modal-f"><button class="btn" id="mClose">Concluir</button></div>
  </div></div>`;
  $('mx').onclick=$('mClose').onclick=closeModal;
  const [profs,links]=await Promise.all([
    db.from('profiles').select('id,nome,email,role').order('nome'),
    db.from('user_companies').select('user_id').eq('company_id',emp.id),
  ]);
  const has=new Set((links.data||[]).map(l=>l.user_id));
  $('euArea').innerHTML=(profs.data||[]).map(p=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #f1f4f7">
    <input type="checkbox" data-user="${p.id}" ${has.has(p.id)?'checked':''} ${p.role==='administrador'?'disabled title="Admin já vê tudo"':''} style="width:16px;height:16px">
    <div style="flex:1"><div style="font-size:13.5px;font-weight:500">${esc(p.nome||p.email)}</div><div style="font-size:12px;color:var(--muted)">${esc(p.email)} · ${p.role}</div></div></div>`).join('') || '<div class="empty">Nenhum usuário cadastrado.</div>';
  $('euArea').querySelectorAll('[data-user]').forEach(c=>c.onchange=()=>toggleEmpUser(emp.id,c.dataset.user,c.checked));
}
async function toggleEmpUser(coId,uid,on){
  if(on){ const { error }=await db.from('user_companies').insert({user_id:uid,company_id:coId}); if(error){toast('Erro.','err');return;} toast('Acesso concedido.'); }
  else { const { error }=await db.from('user_companies').delete().eq('user_id',uid).eq('company_id',coId); if(error){toast('Erro.','err');return;} toast('Acesso removido.'); }
}
