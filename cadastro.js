/* ===================== CADASTROS (clientes, fornecedores, centros de custo, contas financeiras) ===================== */
const TIPO_ACC={conta_corrente:'Conta corrente',poupanca:'Poupança',investimento:'Investimento',caixa:'Caixa'};

const CAD={
  clientes:{table:'customers',title:'Clientes',singular:'cliente',orderBy:'razao_social',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome_fantasia||r.razao_social)},
      {label:'CPF/CNPJ',get:r=>esc(r.cpf_cnpj||'—')},
      {label:'Telefone',get:r=>esc(r.telefone||'—')},
      {label:'Cidade/UF',get:r=>esc([r.cidade,r.estado].filter(Boolean).join('/')||'—')},
      {label:'Status',get:r=>statusPill(r.status)},
    ],
    fields:[
      {k:'razao_social',l:'Razão social / Nome',req:true,col:2},
      {k:'nome_fantasia',l:'Nome fantasia'},{k:'cpf_cnpj',l:'CPF/CNPJ'},
      {k:'email',l:'E-mail'},{k:'telefone',l:'Telefone'},
      {k:'cep',l:'CEP'},{k:'endereco',l:'Endereço',col:2},
      {k:'numero',l:'Número'},{k:'complemento',l:'Complemento'},
      {k:'bairro',l:'Bairro'},{k:'cidade',l:'Cidade'},{k:'estado',l:'UF'},
      {k:'observacoes',l:'Observações',type:'textarea',col:2},
      {k:'status',l:'Status',type:'select',opts:[['ativo','Ativo'],['inativo','Inativo']],def:'ativo'},
    ]},
  fornecedores:{table:'suppliers',title:'Fornecedores',singular:'fornecedor',orderBy:'razao_social',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome_fantasia||r.razao_social)},
      {label:'CPF/CNPJ',get:r=>esc(r.cpf_cnpj||'—')},
      {label:'Telefone',get:r=>esc(r.telefone||'—')},
      {label:'Cidade/UF',get:r=>esc([r.cidade,r.estado].filter(Boolean).join('/')||'—')},
      {label:'Status',get:r=>statusPill(r.status)},
    ],
    fields:[
      {k:'razao_social',l:'Razão social / Nome',req:true,col:2},
      {k:'nome_fantasia',l:'Nome fantasia'},{k:'cpf_cnpj',l:'CPF/CNPJ'},
      {k:'email',l:'E-mail'},{k:'telefone',l:'Telefone'},
      {k:'cep',l:'CEP'},{k:'endereco',l:'Endereço',col:2},
      {k:'numero',l:'Número'},{k:'complemento',l:'Complemento'},
      {k:'bairro',l:'Bairro'},{k:'cidade',l:'Cidade'},{k:'estado',l:'UF'},
      {k:'observacoes',l:'Observações',type:'textarea',col:2},
      {k:'status',l:'Status',type:'select',opts:[['ativo','Ativo'],['inativo','Inativo']],def:'ativo'},
    ]},
  'centros-custo':{table:'cost_centers',title:'Centros de custo',singular:'centro de custo',orderBy:'nome',asc:true,
    columns:[{label:'Nome',get:r=>esc(r.nome)}],
    fields:[{k:'nome',l:'Nome',req:true,col:2}]},
  'contas-financeiras':{table:'financial_accounts',title:'Contas financeiras',singular:'conta financeira',orderBy:'nome',asc:true,
    columns:[
      {label:'Nome',get:r=>esc(r.nome)},
      {label:'Tipo',get:r=>TIPO_ACC[r.tipo]||r.tipo},
      {label:'Banco',get:r=>esc(r.banco||'—')},
      {label:'Saldo inicial',get:r=>money(r.saldo_inicial),r:true},
    ],
    fields:[
      {k:'nome',l:'Nome',req:true,col:2},
      {k:'tipo',l:'Tipo',type:'select',req:true,def:'conta_corrente',
        opts:[['conta_corrente','Conta corrente'],['poupanca','Poupança'],['investimento','Investimento'],['caixa','Caixa']]},
      {k:'banco',l:'Banco'},{k:'agencia',l:'Agência'},{k:'numero',l:'Número'},
      {k:'saldo_inicial',l:'Saldo inicial',type:'number',def:'0'},
      {k:'data_saldo_inicial',l:'Data do saldo inicial',type:'date'},
    ]},
};

async function renderCadastro(key){
  const cfg=CAD[key];
  $('main').innerHTML=`<div class="page-h"><h1>${cfg.title}</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovoCad">+ Novo ${cfg.singular}</button></div>
    <div class="updated">Cadastros da empresa selecionada.</div>
    <div id="cadArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovoCad').onclick=()=>openCadForm(key,null);
  await loadCad(key);
}
async function loadCad(key){
  const cfg=CAD[key];
  const { data,error }=await scopeQ(db.from(cfg.table).select('*')).order(cfg.orderBy,{ascending:cfg.asc});
  if(error){ $('cadArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  cfg._rows=data||[]; drawCad(key);
}
function drawCad(key){
  const cfg=CAD[key], rows=cfg._rows;
  if(!rows.length){ $('cadArea').innerHTML=`<div class="panel"><div class="empty">Nenhum ${cfg.singular} cadastrado ainda. Clique em “+ Novo ${cfg.singular}”.</div></div>`; return; }
  const showCo=!companyId;
  const head=`<tr>${showCo?'<th>Empresa</th>':''}${cfg.columns.map(c=>`<th class="${c.r?'r':''}">${c.label}</th>`).join('')}<th></th></tr>`;
  const body=rows.map((r,i)=>`<tr>${showCo?`<td>${esc(coName(r.company_id))}</td>`:''}${cfg.columns.map(c=>`<td class="${c.r?'r':''}">${c.get(r)}</td>`).join('')}
    <td><div class="act"><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`).join('');
  $('cadArea').innerHTML=`<div class="panel"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  $('cadArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openCadForm(key,rows[+b.dataset.edit]));
  $('cadArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delCad(key,rows[+b.dataset.del]));
}
function cadFieldHTML(f,val){
  const v=val==null?(f.def!=null?f.def:''):val;
  const span=f.col===2?'style="grid-column:1/3"':'';
  if(f.type==='select') return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><select data-k="${f.k}">${f.opts.map(o=>`<option value="${o[0]}" ${String(v)===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></div>`;
  if(f.type==='textarea') return `<div class="field" ${span}><label>${f.l}</label><textarea data-k="${f.k}" rows="2">${esc(v)}</textarea></div>`;
  const t=f.type==='number'?'number':(f.type==='date'?'date':'text');
  return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><input data-k="${f.k}" type="${t}" ${f.type==='number'?'step="0.01"':''} value="${esc(v)}"></div>`;
}
function openCadForm(key,rec){
  const cfg=CAD[key], creating=!rec;
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  const coField=creating?`<div class="field" style="grid-column:1/3"><label>Empresa *</label><select id="cadCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>`:'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Novo':'Editar'} ${cfg.singular}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">${coField}${cfg.fields.map(f=>cadFieldHTML(f,rec?rec[f.k]:null)).join('')}</div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const payload={};
    document.querySelectorAll('#modalRoot [data-k]').forEach(inp=>{ let v=inp.value; payload[inp.dataset.k]=(v===''?null:v); });
    for(const f of cfg.fields) if(f.req && !payload[f.k]){ toast('Preencha: '+f.l,'err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    let res;
    if(creating){ payload.company_id=$('cadCo').value; res=await db.from(cfg.table).insert(payload); }
    else res=await db.from(cfg.table).update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast(cfg.singular[0].toUpperCase()+cfg.singular.slice(1)+(creating?' criado!':' atualizado!')); loadCad(key);
  };
}
async function delCad(key,rec){
  const cfg=CAD[key];
  const nome=rec.nome_fantasia||rec.razao_social||rec.nome||'este registro';
  const ok=await confirmModal({titulo:`Excluir ${cfg.singular}`, texto:`Deseja excluir “${nome}”? Esta ação não pode ser desfeita.`, ok:'Excluir', perigo:true});
  if(!ok) return;
  const { error }=await db.from(cfg.table).delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir (pode estar em uso). '+ (error.message||''),'err'); return; }
  toast('Excluído.'); loadCad(key);
}

/* ===================== CATEGORIAS (hierárquicas) ===================== */
let catRows=[];
async function renderCategorias(){
  $('main').innerHTML=`<div class="page-h"><h1>Categorias</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <button class="btn" id="btnNovaCat">+ Nova categoria</button></div>
    <div class="updated">Receitas e despesas. Pode ter categoria-pai (hierarquia).</div>
    <div id="catArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaCat').onclick=()=>openCatForm(null);
  await loadCategorias();
}
async function loadCategorias(){
  const { data,error }=await scopeQ(db.from('categories').select('*')).order('nome',{ascending:true});
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
    const ordered=[...rows.filter(r=>!r.parent_id),...rows.filter(r=>r.parent_id)];
    const body=ordered.map(c=>{
      const idx=catRows.indexOf(c);
      const nome=c.parent_id?`&nbsp;&nbsp;↳ ${esc(c.nome)}`:`<b>${esc(c.nome)}</b>`;
      return `<tr>${showCo?`<td>${esc(coName(c.company_id))}</td>`:''}<td>${nome}</td><td>${c.parent_id?esc(nameById[c.parent_id]||'—'):'—'}</td>
        <td><div class="act"><button class="lnk" data-edit="${idx}">Editar</button><button class="lnk del" data-del="${idx}">Excluir</button></div></td></tr>`;
    }).join('');
    return `<div class="panel" style="margin-bottom:16px"><h3><span class="dot ${tipo==='receita'?'g':'r'}"></span>${tipo==='receita'?'Receitas':'Despesas'}</h3>
      <table><thead><tr>${showCo?'<th>Empresa</th>':''}<th>Categoria</th><th>Categoria-pai</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
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
      <div class="field"><label>Categoria-pai (opcional)</label><select id="catPai"><option value="">— nenhuma —</option></select></div>
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
  fillPai();
  $('catTipo').onchange=fillPai;
  if(creating) $('catCo').onchange=fillPai;
  $('mSave').onclick=async ()=>{
    const nome=$('catNome').value.trim();
    if(!nome){ toast('Informe o nome.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const payload={ nome, tipo:$('catTipo').value, parent_id:$('catPai').value||null };
    let res;
    if(creating){ payload.company_id=$('catCo').value; res=await db.from('categories').insert(payload); }
    else res=await db.from('categories').update(payload).eq('id',rec.id);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(res.error){ toast('Erro: '+res.error.message,'err'); return; }
    closeModal(); toast('Categoria '+(creating?'criada!':'atualizada!')); loadCategorias();
  };
}
async function delCat(rec){
  const ok=await confirmModal({titulo:'Excluir categoria', texto:`Deseja excluir a categoria “${rec.nome}”?`, ok:'Excluir', perigo:true});
  if(!ok) return;
  const { error }=await db.from('categories').delete().eq('id',rec.id);
  if(error){ toast('Não foi possível excluir (pode estar em uso).','err'); return; }
  toast('Excluída.'); loadCategorias();
}

/* ===================== EMPRESAS + ACESSO ===================== */
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