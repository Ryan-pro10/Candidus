/* ===================== undefined ===================== */
const TIPO_ACC={conta_corrente:'Conta corrente',poupanca:'Poupança',investimento:'Investimento',caixa:'Caixa',cartao_credito:'Cartão de crédito'};

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
        opts:[['conta_corrente','Conta corrente'],['poupanca','Poupança'],['investimento','Investimento'],['caixa','Caixa'],['cartao_credito','Cartão de crédito']]},
      {k:'banco',l:'Banco'},{k:'agencia',l:'Agência'},{k:'numero',l:'Número'},
      {k:'saldo_inicial',l:'Saldo inicial',type:'number',def:'0'},
      {k:'data_saldo_inicial',l:'Data do saldo inicial',type:'date'},
      {k:'dia_fechamento',l:'Dia de fechamento (cartão)',type:'number'},
      {k:'dia_vencimento',l:'Dia de vencimento (cartão)',type:'number'},
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
