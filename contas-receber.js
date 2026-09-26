/* ===================== CONTAS A RECEBER ===================== */
let crCache={titles:[],byId:{}};
let crFilters={cliente:'',status:'',busca:''};
const openTitles=new Set();

async function renderContasReceber(){
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Contas a receber</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
      <button class="btn" id="btnNova">+ Nova conta a receber</button></div>
    <div class="updated">Títulos agrupados — clique numa linha para abrir as parcelas.</div>
    <div id="crFilters"></div>
    <div id="crArea"><div class="loading">Carregando…</div></div>`;
  $('btnNova').onclick=openNovaReceber;
  await loadReceber();
}

async function loadReceber(){
  try{
    const [recs,insts]=await Promise.all([
      scopeQ(db.from('receivables').select('id,customer_id,descricao,documento,valor_total,status,created_at,company_id,customers(razao_social,nome_fantasia)')).order('created_at',{ascending:false}),
      scopeQ(db.from('vw_contas_receber').select('id,receivable_id,numero,total_parcelas,competencia,vencimento,valor,valor_recebido,saldo,situacao')),
    ]);
    if(recs.error) throw recs.error; if(insts.error) throw insts.error;
    const byRec={}; (insts.data||[]).forEach(i=>{(byRec[i.receivable_id]=byRec[i.receivable_id]||[]).push(i);});
    Object.values(byRec).forEach(arr=>arr.sort((a,b)=>a.numero-b.numero));
    const titles=(recs.data||[]).map(r=>{
      const parc=byRec[r.id]||[];
      const cliente=r.customers?(r.customers.nome_fantasia||r.customers.razao_social):'—';
      const recebido=parc.reduce((s,p)=>s+Number(p.valor_recebido||0),0);
      const saldo=parc.reduce((s,p)=>s+Number(p.saldo||0),0);
      const temVencido=parc.some(p=>p.situacao==='vencido');
      return {...r,cliente,parc,recebido,saldo,temVencido};
    });
    crCache={titles,byId:Object.fromEntries(titles.map(t=>[t.id,t]))};
    renderCrFilters(); drawReceber();
  }catch(err){
    $('crArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}

function renderCrFilters(){
  const clientes=[...new Map(crCache.titles.filter(t=>t.customer_id).map(t=>[t.customer_id,t.cliente])).entries()];
  $('crFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Cliente</label><select id="fCli"><option value="">Todos</option>${clientes.map(([id,n])=>`<option value="${id}" ${crFilters.cliente===id?'selected':''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="fg"><label>Situação</label><select id="fSt">
      <option value="">Todas</option>
      <option value="aberto" ${crFilters.status==='aberto'?'selected':''}>Em aberto</option>
      <option value="vencido" ${crFilters.status==='vencido'?'selected':''}>Com vencido</option>
      <option value="quitado" ${crFilters.status==='quitado'?'selected':''}>Quitados</option>
      <option value="cancelado" ${crFilters.status==='cancelado'?'selected':''}>Cancelados</option></select></div>
    <div class="fg"><label>Buscar descrição</label><input id="fBusca" placeholder="ex: consultoria" value="${esc(crFilters.busca)}"></div>
  </div>`;
  $('fCli').onchange=e=>{crFilters.cliente=e.target.value;drawReceber();};
  $('fSt').onchange=e=>{crFilters.status=e.target.value;drawReceber();};
  $('fBusca').oninput=e=>{crFilters.busca=e.target.value;drawReceber();};
}

function drawReceber(){
  let rows=crCache.titles;
  if(crFilters.cliente) rows=rows.filter(t=>t.customer_id===crFilters.cliente);
  if(crFilters.busca) rows=rows.filter(t=>(t.descricao||'').toLowerCase().includes(crFilters.busca.toLowerCase()));
  if(crFilters.status==='vencido') rows=rows.filter(t=>t.temVencido);
  else if(crFilters.status) rows=rows.filter(t=>t.status===crFilters.status);

  if(!rows.length){ $('crArea').innerHTML='<div class="panel"><div class="empty">Nenhuma conta a receber encontrada.</div></div>'; return; }

  const body=rows.map(t=>{
    const open=openTitles.has(t.id);
    const stKey=t.temVencido&&t.status==='aberto'?'vencido':t.status;
    const titleRow=`<tr class="title-row" data-id="${t.id}">
      <td><span class="caret ${open?'open':''}">▶</span>${esc(t.cliente)}</td>
      <td>${esc(t.descricao)}</td>
      <td>${esc(t.documento||'—')}</td>
      <td>${t.parc.length>1?t.parc.length+'x':'à vista'}</td>
      <td class="r">${money(t.valor_total)}</td>
      <td class="r">${money(t.recebido)}</td>
      <td class="r">${money(t.saldo)}</td>
      <td><span class="pill st-${stKey}">${STLABEL[stKey]||stKey}</span></td></tr>`;
    let instRows='';
    if(open){
      instRows=t.parc.map(p=>{
        const canBaixa=!['recebido','cancelado'].includes(p.situacao)&&Number(p.saldo)>0;
        return `<tr class="inst-row"><td colspan="3" style="padding-left:38px">Parcela ${p.numero}/${p.total_parcelas} · venc. ${fmtDate(p.vencimento)}</td>
          <td><span class="pill st-${p.situacao}">${STLABEL[p.situacao]||p.situacao}</span></td>
          <td class="r">${money(p.valor)}</td><td class="r">${money(p.valor_recebido)}</td><td class="r">${money(p.saldo)}</td>
          <td>${canBaixa?`<button class="mini" data-baixa="${p.id}">Receber</button>`:'—'}</td></tr>`;
      }).join('');
    }
    return titleRow+instRows;
  }).join('');

  $('crArea').innerHTML=`<div class="panel"><table>
    <thead><tr><th>Cliente</th><th>Descrição</th><th>Documento</th><th>Parc.</th>
      <th class="r">Valor</th><th class="r">Recebido</th><th class="r">Saldo</th><th>Situação</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;

  $('crArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const id=tr.dataset.id; openTitles.has(id)?openTitles.delete(id):openTitles.add(id); drawReceber();
  });
  $('crArea').querySelectorAll('[data-baixa]').forEach(b=>b.onclick=e=>{
    e.stopPropagation(); openBaixa(b.dataset.baixa);
  });
}

/* ---------- MODAL: NOVA CONTA A RECEBER ---------- */
async function openNovaReceber(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Nova conta a receber</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa</label><select id="nCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label>Cliente</label><select id="nCli"><option value="">—</option></select></div>
        <div class="field"><label>Documento</label><input id="nDoc" placeholder="NF, contrato…"></div>
      </div>
      <div class="field"><label>Descrição *</label><input id="nDesc" placeholder="ex: Consultoria mensal"></div>
      <div class="row2">
        <div class="field"><label>Categoria</label><select id="nCat"><option value="">—</option></select></div>
        <div class="field"><label>Centro de custo</label><select id="nCC"><option value="">—</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Conta financeira</label><select id="nAcc"><option value="">—</option></select></div>
        <div class="field"><label>Forma de recebimento</label><select id="nForma">
          <option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option>
          <option value="transferencia">Transferência</option><option value="cartao">Cartão</option>
          <option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Valor total *</label><input id="nVal" type="number" step="0.01" min="0" placeholder="0,00"></div>
        <div class="field"><label>Data de emissão</label><input id="nEmis" type="date" value="${todayStr()}"></div>
      </div>
      <div class="field"><label>Tipo</label>
        <div class="seg"><button type="button" id="tVista" class="on">À vista</button><button type="button" id="tParc">Parcelado</button></div></div>
      <div class="row2">
        <div class="field"><label>1º vencimento *</label><input id="nVenc" type="date" value="${todayStr()}"></div>
        <div class="field" id="wrapParc" style="display:none"><label>Qtd. parcelas</label><input id="nQtd" type="number" min="2" value="2"></div>
      </div>
      <div class="field" id="wrapInt" style="display:none"><label>Intervalo entre parcelas (meses)</label><input id="nInt" type="number" min="1" value="1"><div class="hint">Ex.: 12 parcelas com intervalo 1 = mensais (1/12, 2/12…).</div></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  let tipo='a_vista';
  $('tVista').onclick=()=>{tipo='a_vista';$('tVista').classList.add('on');$('tParc').classList.remove('on');$('wrapParc').style.display='none';$('wrapInt').style.display='none';};
  $('tParc').onclick=()=>{tipo='parcelado';$('tParc').classList.add('on');$('tVista').classList.remove('on');$('wrapParc').style.display='';$('wrapInt').style.display='';};

  await fillNovaSelects(defaultCo);
  $('nCo').onchange=()=>fillNovaSelects($('nCo').value);

  $('mSave').onclick=async ()=>{
    const desc=$('nDesc').value.trim(), val=parseFloat($('nVal').value);
    if(!desc){ toast('Informe a descrição.','err'); return; }
    if(!(val>0)){ toast('Informe um valor válido.','err'); return; }
    if(!$('nVenc').value){ toast('Informe o 1º vencimento.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const params={
      p_company_id:$('nCo').value, p_customer_id:$('nCli').value||null, p_descricao:desc,
      p_valor_total:val, p_primeiro_vencimento:$('nVenc').value,
      p_qtd_parcelas: tipo==='parcelado'?parseInt($('nQtd').value||'1'):1,
      p_intervalo_meses: tipo==='parcelado'?parseInt($('nInt').value||'1'):1,
      p_categoria_id:$('nCat').value||null, p_cost_center_id:$('nCC').value||null,
      p_financial_account_id:$('nAcc').value||null, p_documento:$('nDoc').value||null,
      p_forma_recebimento:$('nForma').value||null, p_data_emissao:$('nEmis').value||null,
    };
    const { error }=await db.rpc('criar_conta_receber',params);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(error){ toast('Erro ao salvar: '+error.message,'err'); return; }
    closeModal(); toast('Conta a receber criada!'); loadReceber();
  };
}
async function fillNovaSelects(co){
  if(!co) return;
  const [cli,cat,cc,acc]=await Promise.all([
    db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('categories').select('id,nome,tipo').eq('company_id',co).eq('tipo','receita').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
  $('nCli').innerHTML=opt(cli,x=>x.nome_fantasia||x.razao_social);
  $('nCat').innerHTML=opt(cat,x=>x.nome);
  $('nCC').innerHTML=opt(cc,x=>x.nome);
  $('nAcc').innerHTML=opt(acc,x=>x.nome);
}

/* ---------- MODAL: BAIXA (RECEBER) ---------- */
async function openBaixa(instId){
  let inst=null;
  for(const t of crCache.titles){ const p=t.parc.find(x=>x.id===instId); if(p){inst={...p,cliente:t.cliente,descricao:t.descricao,company_id:t.company_id};break;} }
  if(!inst){ toast('Parcela não encontrada.','err'); return; }
  const co=inst.company_id||companyId||(companies[0]&&companies[0].id);
  const accRes=await db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome');
  const accs=accRes.data||[];
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Receber parcela</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="box"><b>${esc(inst.descricao)}</b> — ${esc(inst.cliente)}<br>
        Parcela ${inst.numero}/${inst.total_parcelas} · venc. ${fmtDate(inst.vencimento)}<br>
        Valor ${money(inst.valor)} · já recebido ${money(inst.valor_recebido)} · <b>saldo ${money(inst.saldo)}</b></div>
      <div class="field"><label>Valor a receber *</label><input id="bVal" type="number" step="0.01" min="0" max="${inst.saldo}" value="${Number(inst.saldo).toFixed(2)}"><div class="hint">Pode receber menos que o saldo (recebimento parcial).</div></div>
      <div class="row2">
        <div class="field"><label>Data *</label><input id="bData" type="date" value="${todayStr()}"></div>
        <div class="field"><label>Conta financeira *</label><select id="bAcc"><option value="">—</option>${accs.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Forma</label><select id="bForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      <div class="field"><label>Observação</label><input id="bObs" placeholder="opcional"></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Confirmar recebimento</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const val=parseFloat($('bVal').value);
    if(!(val>0)){ toast('Informe o valor.','err'); return; }
    if(val>Number(inst.saldo)+0.005){ toast('Valor maior que o saldo da parcela.','err'); return; }
    if(!$('bAcc').value){ toast('Selecione a conta financeira.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Confirmando…';
    const { error }=await db.rpc('baixar_receivable_installment',{
      p_installment_id:instId, p_valor:val, p_financial_account_id:$('bAcc').value,
      p_data:$('bData').value||todayStr(), p_forma:$('bForma').value||null, p_observacao:$('bObs').value||null,
    });
    $('mSave').disabled=false; $('mSave').textContent='Confirmar recebimento';
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast('Recebimento registrado!'); loadReceber();
  };
}