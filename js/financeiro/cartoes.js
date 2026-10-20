/* ===================== CARTÕES DE CRÉDITO ===================== */
let cardList=[], cardSel=null, cardFaturas=[];
const openFat=new Set();
function faturaVenc(dataCompra, diaFech, diaVenc){
  const d=new Date(dataCompra+'T00:00:00'); let y=d.getFullYear(), m=d.getMonth(); const day=d.getDate();
  if(day>diaFech) m+=1;                 // passou do fechamento -> próxima fatura
  if(!(diaVenc>diaFech)) m+=1;          // vencimento cai no mês seguinte ao fechamento
  const due=new Date(y,m,1); const last=new Date(due.getFullYear(),due.getMonth()+1,0).getDate();
  due.setDate(Math.min(diaVenc,last)); return due.toISOString().slice(0,10);
}
async function renderCartoes(){
  $('main').innerHTML=`<div class="page-h"><h1>Cartões</h1><span class="scope">${companyId?'':'· todas as empresas'}</span></div>
    <div class="updated">A compra entra na fatura certa pelo fechamento. Vira despesa na data da compra; o caixa só mexe quando você paga a fatura.</div>
    <div id="cardArea"><div class="loading">Carregando…</div></div>`;
  const { data,error }=await scopeQ(db.from('financial_accounts').select('*').eq('tipo','cartao_credito')).order('nome');
  if(error){ $('cardArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  cardList=data||[];
  if(!cardList.length){ $('cardArea').innerHTML='<div class="panel"><div class="empty">Nenhum cartão cadastrado.<br>Vá em <b>Contas financeiras → + Novo</b>, escolha o tipo <b>Cartão de crédito</b> e informe os dias de fechamento e vencimento.</div></div>'; return; }
  cardSel=cardList[0].id;
  $('cardArea').innerHTML=`<div class="filters">
      <div class="fg"><label>Cartão</label><select id="cardPick">${cardList.map(c=>`<option value="${c.id}">${esc(c.nome)}${companyId?'':' — '+esc(coName(c.company_id))}</option>`).join('')}</select></div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="btnNovaDesp" style="align-self:end">+ Nova despesa no cartão</button>
    </div>
    <div id="fatArea"></div>`;
  $('cardPick').onchange=e=>{ cardSel=e.target.value; loadFaturas(); };
  $('btnNovaDesp').onclick=()=>openNovaDespCartao();
  await loadFaturas();
}
async function loadFaturas(){
  $('fatArea').innerHTML='<div class="loading">Carregando faturas…</div>';
  const card=cardList.find(c=>c.id===cardSel);
  const { data,error }=await db.from('payable_installments').select('*, payables!inner(descricao,financial_account_id)').eq('payables.financial_account_id',cardSel);
  if(error){ $('fatArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(error.message)}</div></div>`; return; }
  const insts=(data||[]).filter(i=>i.status!=='cancelado');
  const byVenc={}; insts.forEach(i=>{(byVenc[i.vencimento]=byVenc[i.vencimento]||[]).push(i);});
  cardFaturas=Object.keys(byVenc).sort().map(v=>{
    const items=byVenc[v];
    const total=items.reduce((s,i)=>s+Number(i.valor),0);
    const pago=items.reduce((s,i)=>s+Number(i.valor_pago||0),0);
    const saldo=items.reduce((s,i)=>s+Number(i.saldo||0),0);
    return {venc:v,items,total,pago,saldo,paga:saldo<=0.005};
  });
  drawFaturas(card);
}
function drawFaturas(card){
  const info=`<div class="box" style="display:flex;gap:24px;flex-wrap:wrap">
    <div><b>${esc(card.nome)}</b>${card.banco?' · '+esc(card.banco):''}</div>
    <div>Fechamento: dia <b>${card.dia_fechamento||'—'}</b></div>
    <div>Vencimento: dia <b>${card.dia_vencimento||'—'}</b></div>
    <div>Em aberto: <b>${money(cardFaturas.reduce((s,f)=>s+f.saldo,0))}</b></div></div>`;
  if(!cardFaturas.length){ $('fatArea').innerHTML=info+'<div class="panel"><div class="empty">Nenhuma despesa lançada neste cartão ainda.</div></div>'; return; }
  const body=cardFaturas.map((f,i)=>{
    const open=openFat.has(f.venc);
    const main=`<tr class="title-row" data-i="${i}">
      <td><span class="caret ${open?'open':''}">▶</span>Fatura ${fmtDate(f.venc)}</td>
      <td>${f.items.length} compra(s)</td>
      <td class="r">${money(f.total)}</td><td class="r">${money(f.pago)}</td><td class="r">${money(f.saldo)}</td>
      <td><span class="pill ${f.paga?'st-recebido':(f.venc<todayStr()?'st-vencido':'st-a_vencer')}">${f.paga?'Paga':(f.venc<todayStr()?'Vencida':'Aberta')}</span></td>
      <td>${f.saldo>0.005?`<button class="mini" data-pay="${i}">Pagar fatura</button>`:'—'}</td></tr>`;
    let det='';
    if(open){ det=`<tr><td colspan="7" style="padding:0;background:var(--panel-2)"><table style="margin:0"><tbody>${f.items.map(it=>`
      <tr class="inst-row"><td style="padding-left:38px">${esc(it.payables.descricao)}${it.total_parcelas>1?` · ${it.numero}/${it.total_parcelas}`:''}</td>
      <td style="color:var(--muted)">compet. ${it.competencia?fmtDate(it.competencia):'—'}</td>
      <td class="r">${money(it.valor)}</td><td class="r">${money(it.valor_pago)}</td><td class="r">${money(it.saldo)}</td><td colspan="2"></td></tr>`).join('')}</tbody></table></td></tr>`; }
    return main+det;
  }).join('');
  $('fatArea').innerHTML=info+`<div class="panel"><table><thead><tr><th>Fatura</th><th>Compras</th><th class="r">Total</th><th class="r">Pago</th><th class="r">Saldo</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('fatArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=e=>{ if(e.target.closest('button'))return; const f=cardFaturas[+tr.dataset.i]; openFat.has(f.venc)?openFat.delete(f.venc):openFat.add(f.venc); drawFaturas(card); });
  $('fatArea').querySelectorAll('[data-pay]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openPagarFatura(cardFaturas[+b.dataset.pay], card); });
}
async function openNovaDespCartao(){
  const card=cardList.find(c=>c.id===cardSel);
  if(!card.dia_fechamento||!card.dia_vencimento){ toast('Defina o dia de fechamento e vencimento do cartão em Contas financeiras.','err'); return; }
  const [cat,cc]=await Promise.all([
    db.from('categories').select('id,nome').eq('company_id',card.company_id).eq('tipo','despesa').order('nome'),
    db.from('cost_centers').select('id,nome').eq('company_id',card.company_id).order('nome'),
  ]);
  const opt=(arr)=>'<option value="">—</option>'+(arr.data||[]).map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Nova despesa no cartão</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box">Cartão: <b>${esc(card.nome)}</b> · fecha dia ${card.dia_fechamento}, vence dia ${card.dia_vencimento}</div>
      <div class="field"><label>Descrição *</label><input id="dcDesc" placeholder="ex: Combustível posto X"></div>
      <div class="row2">
        <div class="field"><label>Valor total *</label><input id="dcVal" type="number" step="0.01" min="0" placeholder="0,00"></div>
        <div class="field"><label>Data da compra *</label><input id="dcData" type="date" value="${todayStr()}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Categoria</label><select id="dcCat">${opt(cat)}</select></div>
        <div class="field"><label>Centro de custo</label><select id="dcCC">${opt(cc)}</select></div>
      </div>
      <div class="field"><label>Parcelas</label><input id="dcParc" type="number" min="1" value="1"><div class="hint" id="dcHint"></div></div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Lançar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const upHint=()=>{ const dt=$('dcData').value; if(!dt){$('dcHint').textContent='';return;} const v=faturaVenc(dt,card.dia_fechamento,card.dia_vencimento); const n=+$('dcParc').value||1; $('dcHint').textContent=n>1?`1ª parcela na fatura de ${fmtDate(v)}; as demais nos meses seguintes.`:`Entra na fatura de ${fmtDate(v)}.`; };
  $('dcData').oninput=upHint; $('dcParc').oninput=upHint; upHint();
  $('mSave').onclick=async ()=>{
    const desc=$('dcDesc').value.trim(), val=parseFloat($('dcVal').value), dt=$('dcData').value;
    if(!desc){toast('Informe a descrição.','err');return;}
    if(!(val>0)){toast('Informe o valor.','err');return;}
    if(!dt){toast('Informe a data da compra.','err');return;}
    const venc=faturaVenc(dt,card.dia_fechamento,card.dia_vencimento);
    const comp=dt.slice(0,7)+'-01';
    $('mSave').disabled=true; $('mSave').textContent='Lançando…';
    const { error }=await db.rpc('criar_conta_pagar',{ p_company_id:card.company_id, p_supplier_id:null, p_descricao:desc,
      p_valor_total:val, p_primeiro_vencimento:venc, p_qtd_parcelas:parseInt($('dcParc').value||'1'), p_intervalo_meses:1,
      p_categoria_id:$('dcCat').value||null, p_cost_center_id:$('dcCC').value||null, p_financial_account_id:card.id,
      p_forma_pagamento:'cartao', p_data_emissao:dt, p_competencia:comp });
    $('mSave').disabled=false; $('mSave').textContent='Lançar';
    if(error){ toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast('Despesa lançada no cartão!'); loadFaturas();
  };
}
async function openPagarFatura(fat, card){
  const { data:accs }=await db.from('financial_accounts').select('id,nome,tipo').eq('company_id',card.company_id).neq('tipo','cartao_credito').order('nome');
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
    <div class="modal-h"><h2>Pagar fatura</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="box"><b>${esc(card.nome)}</b> · Fatura ${fmtDate(fat.venc)}<br>Total ${money(fat.total)} · já pago ${money(fat.pago)} · <b>saldo ${money(fat.saldo)}</b></div>
      <div style="font-size:12px;font-weight:600;color:var(--ink);margin-bottom:6px">Compras desta fatura</div>
      <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:14px">
        ${fat.items.map(it=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 12px;border-top:1px solid #f1f4f7;font-size:13px">
          <span>${esc(it.payables.descricao)}${it.total_parcelas>1?` · ${it.numero}/${it.total_parcelas}`:''}${Number(it.saldo)<=0.005?' <span class="pill st-recebido" style="font-size:9px">pago</span>':''}</span>
          <b class="r">${money(it.saldo>0.005?it.saldo:it.valor)}</b></div>`).join('')}
      </div>
      <div class="row2">
        <div class="field"><label>Pagar da conta *</label><select id="pfAcc"><option value="">—</option>${(accs||[]).map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
        <div class="field"><label>Data *</label><input id="pfData" type="date" value="${todayStr()}"></div>
      </div>
      <div class="hint">O saldo de cada compra é baixado; a saída de caixa sai da conta escolhida.</div>
    </div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Confirmar pagamento</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    const acc=$('pfAcc').value; if(!acc){toast('Escolha a conta de pagamento.','err');return;}
    const dt=$('pfData').value||todayStr();
    $('mSave').disabled=true; $('mSave').textContent='Pagando…';
    try{
      for(const it of fat.items){ if(Number(it.saldo)>0.005){
        const { error }=await db.rpc('baixar_payable_installment',{ p_installment_id:it.id, p_valor:Number(it.saldo), p_financial_account_id:acc, p_data:dt, p_forma:'fatura cartão', p_observacao:'Pagamento fatura '+card.nome, p_descricao:'Fatura '+card.nome+' · '+it.payables.descricao });
        if(error) throw error;
      }}
      closeModal(); toast('Fatura paga!'); loadFaturas();
    }catch(err){ toast('Erro: '+(err.message||err),'err'); $('mSave').disabled=false; $('mSave').textContent='Confirmar pagamento'; }
  };
}
