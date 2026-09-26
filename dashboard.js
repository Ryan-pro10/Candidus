/* ===================== DASHBOARD ===================== */
async function renderDashboard(){
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Dashboard</h1><span class="scope">${companyId?'':'· consolidado (todas as empresas)'}</span></div>
    <div class="updated">Atualizado agora · ${new Date().toLocaleString('pt-BR')}</div>
    <div id="dashArea"><div class="loading">Carregando dados…</div></div>`;
  try{
    const [acc,tx,rec,pag]=await Promise.all([
      scopeQ(db.from('financial_accounts').select('saldo_inicial,company_id')),
      scopeQ(db.from('bank_transactions').select('tipo,valor,company_id')),
      scopeQ(db.from('vw_contas_receber').select('saldo,situacao,vencimento,descricao,company_id')),
      scopeQ(db.from('vw_contas_pagar').select('saldo,situacao,vencimento,descricao,company_id')),
    ]);
    for(const r of [acc,tx,rec,pag]) if(r.error) throw r.error;
    const A=acc.data||[],T=tx.data||[],R=rec.data||[],P=pag.data||[];
    const sum=(arr,f)=>arr.reduce((s,x)=>s+Number(f(x)||0),0);
    const saldoAtual=sum(A,x=>x.saldo_inicial)+sum(T.filter(t=>t.tipo==='entrada'),x=>x.valor)-sum(T.filter(t=>t.tipo==='saida'),x=>x.valor);
    const aberto=s=>!['recebido','pago','cancelado'].includes(s);
    const aReceber=sum(R.filter(r=>aberto(r.situacao)),x=>x.saldo);
    const aPagar=sum(P.filter(p=>aberto(p.situacao)),x=>x.saldo);
    const vencR=sum(R.filter(r=>r.situacao==='vencido'),x=>x.saldo);
    const vencP=sum(P.filter(p=>p.situacao==='vencido'),x=>x.saldo);
    const lim=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const recebPrev=sum(R.filter(r=>r.situacao==='a_vencer'&&r.vencimento<=lim),x=>x.saldo);
    const pagPrev=sum(P.filter(p=>p.situacao==='a_vencer'&&p.vencimento<=lim),x=>x.saldo);
    const cards=[
      {lbl:'Saldo atual',dot:'t',val:money(saldoAtual),cls:saldoAtual<0?'neg':''},
      {lbl:'Contas a receber',dot:'g',val:money(aReceber)},
      {lbl:'Contas a pagar',dot:'r',val:money(aPagar)},
      {lbl:'Resultado (rec − pag)',dot:'t',val:money(aReceber-aPagar),cls:(aReceber-aPagar)<0?'neg':'pos'},
      {lbl:'Recebimentos previstos (30d)',dot:'g',val:money(recebPrev)},
      {lbl:'Pagamentos previstos (30d)',dot:'a',val:money(pagPrev)},
      {lbl:'Vencido a receber',dot:'r',val:money(vencR),cls:vencR>0?'warn':''},
      {lbl:'Vencido a pagar',dot:'r',val:money(vencP),cls:vencP>0?'neg':''},
    ];
    const prox=[...R.filter(r=>r.situacao==='a_vencer').map(r=>({tipo:'receber',...r})),...P.filter(p=>p.situacao==='a_vencer').map(p=>({tipo:'pagar',...p}))]
      .sort((a,b)=>a.vencimento.localeCompare(b.vencimento)).slice(0,8);
    const venc=[...R.filter(r=>r.situacao==='vencido').map(r=>({tipo:'receber',...r})),...P.filter(p=>p.situacao==='vencido').map(p=>({tipo:'pagar',...p}))]
      .sort((a,b)=>daysLate(b.vencimento)-daysLate(a.vencimento)).slice(0,8);
    $('dashArea').innerHTML=`
      <div class="cards">${cards.map(c=>`<div class="kpi"><div class="lbl"><span class="dot ${c.dot}"></span>${c.lbl}</div><div class="val ${c.cls||''}">${c.val}</div></div>`).join('')}</div>
      <div class="grid2">
        <div class="panel"><h3><span class="dot t"></span>Próximos vencimentos</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th class="r">Valor</th></tr></thead><tbody>
          ${prox.length?prox.map(x=>`<tr><td>${esc(x.descricao)}</td><td><span class="pill ${x.tipo}">${x.tipo==='receber'?'A receber':'A pagar'}</span></td><td>${fmtDate(x.vencimento)}</td><td class="r">${money(x.saldo)}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nada a vencer.</div></td></tr>'}
          </tbody></table></div>
        <div class="panel"><h3><span class="dot r"></span>Contas vencidas</h3>
          <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Atraso</th><th class="r">Valor</th></tr></thead><tbody>
          ${venc.length?venc.map(x=>`<tr><td>${esc(x.descricao)}</td><td><span class="pill ${x.tipo}">${x.tipo==='receber'?'A receber':'A pagar'}</span></td><td>${daysLate(x.vencimento)} dias</td><td class="r">${money(x.saldo)}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nenhuma conta vencida. 👏</div></td></tr>'}
          </tbody></table></div>
      </div>`;
  }catch(err){
    $('dashArea').innerHTML=`<div class="panel"><div class="empty">Não foi possível carregar os dados.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}