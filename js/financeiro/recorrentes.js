/* ===================== LANÇAMENTOS RECORRENTES ===================== */
const PERIOD={semanal:'Semanal',quinzenal:'Quinzenal',mensal:'Mensal',trimestral:'Trimestral',anual:'Anual'};
let recRows=[];
async function renderRecorrentes(){
  $('main').innerHTML=`<div class="page-h"><h1>Recorrentes</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
    <div class="hbtns"><button class="btn ghost" id="recGerar">Gerar lançamentos pendentes</button><button class="btn" id="recNova">+ Nova recorrência</button></div></div>
    <div class="updated">Contas fixas (aluguel, mensalidades…). O sistema gera o lançamento automaticamente a cada período — inclusive ao abrir o sistema.</div>
    <div id="recArea"><div class="loading">Carregando…</div></div>`;
  $('recNova').onclick=()=>openRecForm(null);
  $('recGerar').onclick=async ()=>{ const { data,error }=await db.rpc('gerar_recorrencias', companyId?{p_company:companyId}:{}); if(error){toast('Erro: '+error.message,'err');return;} toast((data||0)+' lançamento(s) gerado(s).'); loadRecorrentes(); };
  await loadRecorrentes();
}
async function loadRecorrentes(){
  const { data,error }=await scopeQ(db.from('recurring_entries').select('*, customers(razao_social,nome_fantasia), suppliers(razao_social,nome_fantasia)')).order('proxima');
  if(error){ $('recArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  recRows=data||[]; drawRecorrentes();
}
function drawRecorrentes(){
  if(!recRows.length){ $('recArea').innerHTML='<div class="panel"><div class="empty">Nenhuma recorrência. Clique em “+ Nova recorrência”.</div></div>'; return; }
  const showCo=!companyId;
  const body=recRows.map((r,i)=>{
    const cp=r.tipo==='receber'?r.customers:r.suppliers;
    const nome=cp&&(cp.nome_fantasia||cp.razao_social)||'—';
    return `<tr>
      <td><span class="pill ${r.tipo==='receber'?'receber':'pagar'}">${r.tipo==='receber'?'Receber':'Pagar'}</span></td>
      <td><b>${esc(r.descricao)}</b>${nome!=='—'?`<br><span style="font-size:12px;color:var(--muted)">${esc(nome)}</span>`:''}</td>
      ${showCo?`<td>${esc(coName(r.company_id))}</td>`:''}
      <td class="r">${money(r.valor)}</td>
      <td>${PERIOD[r.periodicidade]}</td>
      <td>${fmtDate(r.proxima)}</td>
      <td><span class="pill ${r.ativo?'st-recebido':'st-cancelado'}">${r.ativo?'Ativa':'Pausada'}</span></td>
      <td><div class="act"><button class="lnk" data-tog="${i}">${r.ativo?'Pausar':'Ativar'}</button><button class="lnk" data-edit="${i}">Editar</button><button class="lnk del" data-del="${i}">Excluir</button></div></td></tr>`;
  }).join('');
  $('recArea').innerHTML=`<div class="panel"><table><thead><tr><th>Tipo</th><th>Descrição</th>${showCo?'<th>Empresa</th>':''}<th class="r">Valor</th><th>Período</th><th>Próximo</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('recArea').querySelectorAll('[data-tog]').forEach(b=>b.onclick=async ()=>{ const r=recRows[+b.dataset.tog]; const { error }=await db.from('recurring_entries').update({ativo:!r.ativo}).eq('id',r.id); if(error){toast('Erro.','err');return;} loadRecorrentes(); });
  $('recArea').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRecForm(recRows[+b.dataset.edit]));
  $('recArea').querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{ const r=recRows[+b.dataset.del]; const ok=await confirmModal({titulo:'Excluir recorrência',texto:`Excluir “${r.descricao}”? As contas já geradas continuam no sistema.`,ok:'Excluir',perigo:true}); if(!ok)return; const { error }=await db.from('recurring_entries').delete().eq('id',r.id); if(error){toast('Erro.','err');return;} toast('Excluída.'); loadRecorrentes(); });
}
async function openRecForm(rec){
  const creating=!rec;
  const defaultCo=rec?rec.company_id:(companyId||(companies[0]&&companies[0].id)||'');
  let tipo=rec?rec.tipo:'pagar';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${creating?'Nova':'Editar'} recorrência</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa *</label><select id="reCo" ${creating?'':'disabled'}>${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo</label><div class="seg"><button type="button" id="reR" class="${tipo==='receber'?'on':''}">A receber</button><button type="button" id="reP" class="${tipo==='pagar'?'on':''}">A pagar</button></div></div>
      <div class="cadgrid">
        <div class="field" id="reContraWrap"><label id="reContraLbl">Fornecedor</label><select id="reContra"><option value="">—</option></select></div>
        <div class="field"><label>Valor *</label><input id="reVal" type="number" step="0.01" min="0" value="${rec?rec.valor:''}"></div>
        <div class="field" style="grid-column:1/3"><label>Descrição *</label><input id="reDesc" value="${esc(rec?rec.descricao:'')}" placeholder="ex: Aluguel do galpão"></div>
        <div class="field"><label>Categoria</label><select id="reCat"><option value="">—</option></select></div>
        <div class="field"><label>Centro de custo</label><select id="reCC"><option value="">—</option></select></div>
        <div class="field"><label>Conta financeira</label><select id="reAcc"><option value="">—</option></select></div>
        <div class="field"><label>Forma</label><select id="reForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
        <div class="field"><label>Periodicidade *</label><select id="rePer">${Object.entries(PERIOD).map(([k,v])=>`<option value="${k}" ${(rec?rec.periodicidade:'mensal')===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>${creating?'Primeiro vencimento *':'Próximo vencimento *'}</label><input id="reIni" type="date" value="${rec?rec.proxima:todayStr()}"></div>
        <div class="field"><label>Encerrar em (opcional)</label><input id="reFim" type="date" value="${rec&&rec.data_fim?rec.data_fim:''}"></div>
      </div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const co=()=> creating?$('reCo').value:rec.company_id;
  let cli=[],forn=[],cats=[];
  async function loadSel(){
    const [c1,c2,c3,c4]=await Promise.all([
      db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co()).order('razao_social'),
      db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co()).order('razao_social'),
      db.from('categories').select('id,nome,tipo').eq('company_id',co()).order('nome'),
      db.from('financial_accounts').select('id,nome').eq('company_id',co()).neq('tipo','cartao_credito').order('nome'),
    ]);
    cli=c1.data||[]; forn=c2.data||[]; cats=c3.data||[];
    $('reCC').innerHTML='<option value="">—</option>'+((await db.from('cost_centers').select('id,nome').eq('company_id',co()).order('nome')).data||[]).map(x=>`<option value="${x.id}" ${rec&&rec.cost_center_id===x.id?'selected':''}>${esc(x.nome)}</option>`).join('');
    $('reAcc').innerHTML='<option value="">—</option>'+(c4.data||[]).map(x=>`<option value="${x.id}" ${rec&&rec.financial_account_id===x.id?'selected':''}>${esc(x.nome)}</option>`).join('');
    refreshContra(); refreshCat();
    if(rec){ $('reForma').value=rec.forma||''; }
  }
  function refreshContra(){
    $('reContraLbl').textContent = tipo==='receber'?'Cliente':'Fornecedor';
    const arr=tipo==='receber'?cli:forn; const cur=rec?(tipo==='receber'?rec.customer_id:rec.supplier_id):null;
    $('reContra').innerHTML='<option value="">—</option>'+arr.map(x=>`<option value="${x.id}" ${cur===x.id?'selected':''}>${esc(x.nome_fantasia||x.razao_social)}</option>`).join('');
  }
  function refreshCat(){ const arr=cats.filter(c=>c.tipo===(tipo==='receber'?'receita':'despesa')); $('reCat').innerHTML='<option value="">—</option>'+arr.map(x=>`<option value="${x.id}" ${rec&&rec.categoria_id===x.id?'selected':''}>${esc(x.nome)}</option>`).join(''); }
  $('reR').onclick=()=>{tipo='receber';$('reR').classList.add('on');$('reP').classList.remove('on');refreshContra();refreshCat();};
  $('reP').onclick=()=>{tipo='pagar';$('reP').classList.add('on');$('reR').classList.remove('on');refreshContra();refreshCat();};
  if(creating) $('reCo').onchange=loadSel;
  await loadSel();
  $('mSave').onclick=async ()=>{
    const desc=$('reDesc').value.trim(), val=parseFloat($('reVal').value);
    if(!desc){toast('Informe a descrição.','err');return;}
    if(!(val>0)){toast('Informe o valor.','err');return;}
    if(!$('reIni').value){toast('Informe o vencimento.','err');return;}
    const payload={ tipo, descricao:desc, valor:val, periodicidade:$('rePer').value,
      customer_id: tipo==='receber'?($('reContra').value||null):null,
      supplier_id: tipo==='pagar'?($('reContra').value||null):null,
      categoria_id:$('reCat').value||null, cost_center_id:$('reCC').value||null,
      financial_account_id:$('reAcc').value||null, forma:$('reForma').value||null,
      data_inicio:$('reIni').value, proxima:$('reIni').value, data_fim:$('reFim').value||null };
    $('mSave').disabled=true;$('mSave').textContent='Salvando…';
    let res;
    if(creating){ payload.company_id=$('reCo').value; res=await db.from('recurring_entries').insert(payload); }
    else { delete payload.data_inicio; res=await db.from('recurring_entries').update(payload).eq('id',rec.id); }
    $('mSave').disabled=false;$('mSave').textContent='Salvar';
    if(res.error){toast('Erro: '+res.error.message,'err');return;}
    closeModal(); toast('Recorrência '+(creating?'criada!':'atualizada!')); loadRecorrentes();
  };
}
