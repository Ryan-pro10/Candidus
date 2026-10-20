/* ===================== CONTAS A PAGAR ===================== */
let cpFilters={forn:'',status:'',busca:''};
let cpPage=0, cpTotal=0, cpForns=[], cpTitles=[], cpBuscaTimer=null;
const openTitlesP=new Set();

async function renderContasPagar(){
  $('main').innerHTML=`<div class="page-h"><h1>Contas a pagar</h1><span class="scope">${companyId?'':'· todas as empresas'}</span><div class="spacer"></div>
      <button class="btn ghost" id="btnLoteP">Lançar em lote</button>
      <button class="btn" id="btnNovaP">+ Nova conta a pagar</button></div>
    <div class="updated">Títulos agrupados — clique numa linha para abrir as parcelas.</div>
    <div id="cpFilters"></div>
    <div id="cpArea"><div class="loading">Carregando…</div></div>`;
  $('btnNovaP').onclick=openNovaPagar;
  $('btnLoteP').onclick=()=>openLote('pagar');
  cpPage=0;
  const { data:forn }=await scopeQ(db.from('suppliers').select('id,razao_social,nome_fantasia')).order('razao_social');
  cpForns=forn||[];
  renderCpFilters();
  await loadPagar();
}
function renderCpFilters(){
  $('cpFilters').innerHTML=`<div class="filters">
    <div class="fg"><label>Fornecedor</label><select id="pFor"><option value="">Todos</option>${cpForns.map(c=>`<option value="${c.id}" ${cpFilters.forn===c.id?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
    <div class="fg"><label>Situação</label><select id="pSt">
      <option value="">Todas</option>
      <option value="aberto" ${cpFilters.status==='aberto'?'selected':''}>Em aberto</option>
      <option value="quitado" ${cpFilters.status==='quitado'?'selected':''}>Quitados</option>
      <option value="cancelado" ${cpFilters.status==='cancelado'?'selected':''}>Cancelados</option></select></div>
    <div class="fg"><label>Buscar descrição</label><input id="pBusca" placeholder="ex: aluguel" value="${esc(cpFilters.busca)}"></div>
  </div>`;
  $('pFor').onchange=e=>{cpFilters.forn=e.target.value;cpPage=0;loadPagar();};
  $('pSt').onchange=e=>{cpFilters.status=e.target.value;cpPage=0;loadPagar();};
  $('pBusca').oninput=e=>{cpFilters.busca=e.target.value;clearTimeout(cpBuscaTimer);cpBuscaTimer=setTimeout(()=>{cpPage=0;loadPagar();},350);};
}
async function loadPagar(){
  try{
    let q=scopeQ(db.from('payables').select('id,supplier_id,descricao,documento,valor_total,status,company_id,cost_center_id,suppliers(razao_social,nome_fantasia),cc_titulo:cost_centers!payables_cost_center_id_fkey(nome),rateio_centro_custo(cost_center_id,percentual,cost_centers(nome))',{count:'exact'}));
    if(cpFilters.forn) q=q.eq('supplier_id',cpFilters.forn);
    if(cpFilters.status) q=q.eq('status',cpFilters.status);
    if(cpFilters.busca) q=q.ilike('descricao',`%${cpFilters.busca}%`);
    q=q.order('created_at',{ascending:false}).range(cpPage*PAGE_SIZE,(cpPage+1)*PAGE_SIZE-1);
    const { data:pays,count,error }=await q; if(error) throw error;
    cpTotal=count||0;
    const ids=(pays||[]).map(p=>p.id);
    let insts=[];
    if(ids.length){ const r2=await db.from('vw_contas_pagar').select('id,payable_id,numero,total_parcelas,competencia,vencimento,valor,valor_pago,saldo,situacao').in('payable_id',ids); if(r2.error) throw r2.error; insts=r2.data||[]; }
    const byPay={}; insts.forEach(i=>{(byPay[i.payable_id]=byPay[i.payable_id]||[]).push(i);});
    Object.values(byPay).forEach(arr=>arr.sort((a,b)=>a.numero-b.numero));
    cpTitles=(pays||[]).map(p=>{ const parc=byPay[p.id]||[];
      return {...p, forn:p.suppliers?(p.suppliers.nome_fantasia||p.suppliers.razao_social):'—', parc,
        pago:parc.reduce((s,x)=>s+Number(x.valor_pago||0),0),
        saldo:parc.reduce((s,x)=>s+Number(x.saldo||0),0),
        temVencido:parc.some(x=>x.situacao==='vencido')}; });
    drawPagar();
  }catch(err){ $('cpArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
function bindCpPager(){
  const p=$('cpArea').querySelector('[data-pg="cp-prev"]'); const n=$('cpArea').querySelector('[data-pg="cp-next"]');
  if(p) p.onclick=()=>{ if(cpPage>0){cpPage--;loadPagar();} };
  if(n) n.onclick=()=>{ if((cpPage+1)*PAGE_SIZE<cpTotal){cpPage++;loadPagar();} };
}

function drawPagar(){
  const rows=cpTitles;
  if(!rows.length){ $('cpArea').innerHTML='<div class="panel"><div class="empty">Nenhuma conta a pagar encontrada.</div></div>'+pagerHTML(cpPage,cpTotal,'cp'); bindCpPager(); return; }

  const body=rows.map(t=>{
    const open=openTitlesP.has(t.id);
    const stKey=t.temVencido&&t.status==='aberto'?'vencido':t.status;
    const titleRow=`<tr class="title-row" data-id="${t.id}">
      <td><span class="caret ${open?'open':''}">▶</span>${esc(t.forn)}</td>
      <td>${esc(t.descricao)}</td>
      <td>${esc(t.documento||'—')}</td>
      <td>${t.parc.length>1?t.parc.length+'x':'à vista'}</td>
      <td class="r">${money(t.valor_total)}</td>
      <td class="r">${money(t.pago)}</td>
      <td class="r">${money(t.saldo)}</td>
      <td><span class="pill st-${stKey}">${STLABEL[stKey]||stKey}</span></td></tr>`;
    let instRows='';
    if(open){
      instRows=t.parc.map(p=>{
        const canBaixa=!['pago','cancelado'].includes(p.situacao)&&Number(p.saldo)>0;
        const temBaixa=Number(p.valor_pago)>0;
        return `<tr class="inst-row"><td colspan="3" style="padding-left:38px">Parcela ${p.numero}/${p.total_parcelas} · venc. ${fmtDate(p.vencimento)}</td>
          <td><span class="pill st-${p.situacao}">${STLABEL[p.situacao]||p.situacao}</span></td>
          <td class="r">${money(p.valor)}</td><td class="r">${money(p.valor_pago)}</td><td class="r">${money(p.saldo)}</td>
          <td><div class="act">${canBaixa?`<button class="mini" data-pagar="${p.id}">Pagar</button>`:''}${temBaixa?`<button class="lnk del" data-estornop="${p.id}">Estornar</button>`:''}${!canBaixa&&!temBaixa?'—':''}</div></td></tr>`;
      }).join('')+rateioLinha('pagar',t);
    }
    return titleRow+instRows;
  }).join('');

  $('cpArea').innerHTML=`<div class="panel"><table>
    <thead><tr><th>Fornecedor</th><th>Descrição</th><th>Documento</th><th>Parc.</th>
      <th class="r">Valor</th><th class="r">Pago</th><th class="r">Saldo</th><th>Situação</th></tr></thead>
    <tbody>${body}</tbody></table></div>`+pagerHTML(cpPage,cpTotal,'cp');

  ligarRateio($('cpArea'),'pagar',cpTitles);
  $('cpArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const id=tr.dataset.id; openTitlesP.has(id)?openTitlesP.delete(id):openTitlesP.add(id); drawPagar();
  });
  $('cpArea').querySelectorAll('[data-pagar]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openPagar(b.dataset.pagar); });
  $('cpArea').querySelectorAll('[data-estornop]').forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    const ok=await confirmModal({titulo:'Estornar pagamento',texto:'Isso desfaz o pagamento desta parcela (volta a em aberto e remove o movimento do caixa). Confirmar?',ok:'Estornar',perigo:true});
    if(!ok) return;
    const { error }=await db.rpc('estornar_baixa',{p_installment_id:b.dataset.estornop,p_tipo:'pagar'});
    if(error){ toast('Erro: '+error.message,'err'); return; } toast('Pagamento estornado.'); loadPagar();
  });
  bindCpPager();
}

/* ---------- MODAL: NOVA CONTA A PAGAR ---------- */
async function openNovaPagar(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Nova conta a pagar</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="field"><label>Empresa</label><select id="pnCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label>Fornecedor</label><select id="pnFor"><option value="">—</option></select></div>
        <div class="field"><label>Documento</label><input id="pnDoc" placeholder="NF, boleto…"></div>
      </div>
      <div class="field"><label>Descrição *</label><input id="pnDesc" placeholder="ex: Aluguel do galpão"></div>
      <div class="row2">
        <div class="field"><label>Categoria</label><select id="pnCat"><option value="">—</option></select></div>
        <div class="field"><label>Centro de custo</label><select id="pnCC"><option value="">—</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Conta financeira</label><select id="pnAcc"><option value="">—</option></select></div>
        <div class="field"><label>Forma de pagamento</label><select id="pnForma">
          <option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option>
          <option value="transferencia">Transferência</option><option value="cartao">Cartão</option>
          <option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Valor total *</label><input id="pnVal" type="number" step="0.01" min="0" placeholder="0,00"></div>
        <div class="field"><label>Data de emissão</label><input id="pnEmis" type="date" value="${todayStr()}"></div>
      </div>
      <div class="field"><label>Tipo</label>
        <div class="seg"><button type="button" id="ptVista" class="on">À vista</button><button type="button" id="ptParc">Parcelado</button></div></div>
      <div class="row2">
        <div class="field"><label>1º vencimento *</label><input id="pnVenc" type="date" value="${todayStr()}"></div>
        <div class="field" id="pwrapParc" style="display:none"><label>Qtd. parcelas</label><input id="pnQtd" type="number" min="2" value="2"></div>
      </div>
      <div class="field" id="pwrapInt" style="display:none"><label>Intervalo entre parcelas (meses)</label><input id="pnInt" type="number" min="1" value="1"><div class="hint">Ex.: 12 parcelas com intervalo 1 = mensais.</div></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  let tipo='a_vista';
  $('ptVista').onclick=()=>{tipo='a_vista';$('ptVista').classList.add('on');$('ptParc').classList.remove('on');$('pwrapParc').style.display='none';$('pwrapInt').style.display='none';};
  $('ptParc').onclick=()=>{tipo='parcelado';$('ptParc').classList.add('on');$('ptVista').classList.remove('on');$('pwrapParc').style.display='';$('pwrapInt').style.display='';};

  await fillNovaPagarSelects(defaultCo);
  $('pnCo').onchange=()=>fillNovaPagarSelects($('pnCo').value);

  $('mSave').onclick=async ()=>{
    const desc=$('pnDesc').value.trim(), val=parseFloat($('pnVal').value);
    if(!desc){ toast('Informe a descrição.','err'); return; }
    if(!(val>0)){ toast('Informe um valor válido.','err'); return; }
    if(!$('pnVenc').value){ toast('Informe o 1º vencimento.','err'); return; }
    if(await contaDuplicada('payables',$('pnCo').value,$('pnFor').value||null,'supplier_id',desc,val,$('pnVenc').value)){
      const ok=await confirmOver({titulo:'Conta parecida já existe',texto:'Já existe uma conta a pagar com a mesma descrição, valor e fornecedor, com vencimento próximo. Deseja lançar mesmo assim?',ok:'Lançar assim mesmo'});
      if(!ok) return;
    }
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    const params={
      p_company_id:$('pnCo').value, p_supplier_id:$('pnFor').value||null, p_descricao:desc,
      p_valor_total:val, p_primeiro_vencimento:$('pnVenc').value,
      p_qtd_parcelas: tipo==='parcelado'?parseInt($('pnQtd').value||'1'):1,
      p_intervalo_meses: tipo==='parcelado'?parseInt($('pnInt').value||'1'):1,
      p_categoria_id:$('pnCat').value||null, p_cost_center_id:$('pnCC').value||null,
      p_financial_account_id:$('pnAcc').value||null, p_documento:$('pnDoc').value||null,
      p_forma_pagamento:$('pnForma').value||null, p_data_emissao:$('pnEmis').value||null,
    };
    const { error }=await db.rpc('criar_conta_pagar',params);
    $('mSave').disabled=false; $('mSave').textContent='Salvar';
    if(error){ toast('Erro ao salvar: '+error.message,'err'); return; }
    closeModal(); toast('Conta a pagar criada!'); loadPagar();
  };
}
async function fillNovaPagarSelects(co){
  if(!co) return;
  const [forn,cat,cc,acc]=await Promise.all([
    db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
    db.from('categories').select('id,nome,tipo').eq('company_id',co).eq('tipo','despesa').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
    db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
  ]);
  const opt=(arr,lbl)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(lbl(x))}</option>`).join('');
  $('pnFor').innerHTML=opt(forn,x=>x.nome_fantasia||x.razao_social);
  $('pnCat').innerHTML=opt(cat,x=>x.nome);
  $('pnCC').innerHTML=opt(cc,x=>x.nome);
  $('pnAcc').innerHTML=opt(acc,x=>x.nome);
}

/* ---------- MODAL: BAIXA (PAGAR) ---------- */
async function openPagar(instId){
  let inst=null;
  for(const t of cpTitles){ const p=t.parc.find(x=>x.id===instId); if(p){inst={...p,forn:t.forn,descricao:t.descricao,company_id:t.company_id};break;} }
  if(!inst){ toast('Parcela não encontrada.','err'); return; }
  const co=inst.company_id||companyId||(companies[0]&&companies[0].id);
  const accRes=await db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome');
  const accs=accRes.data||[];
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Pagar parcela</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="box"><b>${esc(inst.descricao)}</b> — ${esc(inst.forn)}<br>
        Parcela ${inst.numero}/${inst.total_parcelas} · venc. ${fmtDate(inst.vencimento)}<br>
        Valor ${money(inst.valor)} · já pago ${money(inst.valor_pago)} · <b>saldo ${money(inst.saldo)}</b></div>
      <div class="field"><label>Valor a pagar (principal) *</label><input id="bVal" type="number" step="0.01" min="0" max="${inst.saldo}" value="${Number(inst.saldo).toFixed(2)}"><div class="hint">Pode pagar menos que o saldo (pagamento parcial).</div></div>
      <div class="row2">
        <div class="field"><label>Juros</label><input id="bJuros" type="number" step="0.01" min="0" value="0"></div>
        <div class="field"><label>Multa</label><input id="bMulta" type="number" step="0.01" min="0" value="0"></div>
      </div>
      <div class="field"><label>Desconto</label><input id="bDesc" type="number" step="0.01" min="0" value="0"></div>
      <div class="box" id="bCash" style="background:var(--teal-soft);color:var(--teal-d)"></div>
      <div class="row2">
        <div class="field"><label>Data *</label><input id="bData" type="date" value="${todayStr()}"></div>
        <div class="field"><label>Conta financeira *</label><select id="bAcc"><option value="">—</option>${accs.map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Forma</label><select id="bForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
      <div class="field"><label>Observação</label><input id="bObs" placeholder="opcional"></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Confirmar pagamento</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const upCash=()=>{ const c=(parseFloat($('bVal').value)||0)+(parseFloat($('bJuros').value)||0)+(parseFloat($('bMulta').value)||0)-(parseFloat($('bDesc').value)||0); $('bCash').innerHTML='Valor que sai do caixa: <b>'+money(c)+'</b>'; };
  ['bVal','bJuros','bMulta','bDesc'].forEach(id=>$(id).oninput=upCash); upCash();
  $('mSave').onclick=async ()=>{
    const val=parseFloat($('bVal').value);
    if(!(val>0)){ toast('Informe o valor.','err'); return; }
    if(val>Number(inst.saldo)+0.005){ toast('Valor maior que o saldo da parcela.','err'); return; }
    if(!$('bAcc').value){ toast('Selecione a conta financeira.','err'); return; }
    $('mSave').disabled=true; $('mSave').textContent='Confirmando…';
    const { error }=await db.rpc('baixar_payable_installment',{
      p_installment_id:instId, p_valor:val, p_financial_account_id:$('bAcc').value,
      p_data:$('bData').value||todayStr(), p_forma:$('bForma').value||null, p_observacao:$('bObs').value||null,
      p_juros:parseFloat($('bJuros').value)||0, p_multa:parseFloat($('bMulta').value)||0, p_desconto:parseFloat($('bDesc').value)||0,
    });
    $('mSave').disabled=false; $('mSave').textContent='Confirmar pagamento';
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast('Pagamento registrado!'); loadPagar();
  };
}
