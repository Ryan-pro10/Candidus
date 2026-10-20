/* ===================== DASHBOARD (consolidado e por empresa) ===================== */
function dashSelectCompany(id){ companyId=id; const sel=$('companySel'); if(sel) sel.value=id; setView('dashboard'); }
async function renderDashboardConsolidado(){
  $('main').innerHTML=`<div class="page-h"><h1>Visão geral da Candidus</h1><span class="scope">· todas as empresas</span></div>
    <div class="updated">Atualizado agora · ${new Date().toLocaleString('pt-BR')}</div>
    <div id="dashArea"><div class="loading">Carregando dados…</div></div>`;
  try{
    const [res,tsk,unc]=await Promise.all([
      db.rpc('resumo_financeiro',{ p_company:null }),
      db.from('tasks').select('prazo,status,company_id'),
      db.from('bank_transactions').select('id',{count:'exact',head:true}).eq('conciliado',false).eq('origem','importado').in('tipo',['entrada','saida']),
    ]);
    for(const r of [res,tsk]) if(r.error) throw r.error;
    const per={}; // company_id -> agregados (somados no banco: sem limite de 1.000 linhas)
    (res.data||[]).forEach(x=>{ per[x.company_id]={saldoI:Number(x.saldo),ent:0,sai:0,aReceber:Number(x.receber_aberto),aPagar:Number(x.pagar_aberto),vencR:Number(x.receber_vencido),vencP:Number(x.pagar_vencido)}; });
    const hoje=todayStr();
    const tarefasAtras=(tsk.data||[]).filter(t=>t.prazo&&t.prazo<hoje&&!['concluida','cancelada'].includes(t.status)).length;
    const naoConc=unc.count||0;

    const lista=companies.map(c=>{ const p=per[c.id]||{saldoI:0,ent:0,sai:0,aReceber:0,aPagar:0,vencR:0,vencP:0};
      return {id:c.id,nome:c.nome_fantasia||c.razao_social,saldo:p.saldoI+p.ent-p.sai,aReceber:p.aReceber,aPagar:p.aPagar,venc:p.vencR+p.vencP}; });
    const totReceber=lista.reduce((s,x)=>s+x.aReceber,0), totPagar=lista.reduce((s,x)=>s+x.aPagar,0);
    const totVencR=lista.reduce((s,x)=>s+(per[x.id]?per[x.id].vencR:0),0), totVencP=lista.reduce((s,x)=>s+(per[x.id]?per[x.id].vencP:0),0);
    const comVencidos=lista.filter(x=>x.venc>0).length;

    const cards=[
      {lbl:'Empresas atendidas',dot:'t',val:String(companies.length)},
      {lbl:'Empresas com vencidos',dot:'r',val:String(comVencidos),cls:comVencidos>0?'warn':''},
      {lbl:'Total a receber',dot:'g',val:money(totReceber)},
      {lbl:'Total a pagar',dot:'r',val:money(totPagar)},
      {lbl:'Vencido a receber',dot:'r',val:money(totVencR),cls:totVencR>0?'warn':''},
      {lbl:'Vencido a pagar',dot:'r',val:money(totVencP),cls:totVencP>0?'neg':''},
      {lbl:'Movimentos não conciliados',dot:'a',val:String(naoConc),cls:naoConc>0?'warn':''},
      {lbl:'Tarefas atrasadas',dot:'r',val:String(tarefasAtras),cls:tarefasAtras>0?'warn':''},
    ];
    const rows=lista.sort((a,b)=>b.venc-a.venc).map(x=>`<tr class="title-row" data-co="${x.id}">
      <td><b>${esc(x.nome)}</b></td>
      <td class="r ${x.saldo<0?'dre-neg':''}">${money(x.saldo)}</td>
      <td class="r" style="color:var(--green)">${money(x.aReceber)}</td>
      <td class="r" style="color:var(--red)">${money(x.aPagar)}</td>
      <td class="r ${x.venc>0?'dre-neg':''}">${money(x.venc)}</td></tr>`).join('');
    $('dashArea').innerHTML=`<div class="cards">${cards.map(c=>`<div class="kpi"><div class="lbl"><span class="dot ${c.dot}"></span>${c.lbl}</div><div class="val ${c.cls||''}">${c.val}</div></div>`).join('')}</div>
      <div class="panel"><h3><span class="dot t"></span>Por empresa <span style="font-weight:400;color:var(--muted);font-size:12px">— clique numa empresa para abrir o detalhe</span></h3>
      <table><thead><tr><th>Empresa</th><th class="r">Saldo</th><th class="r">A receber</th><th class="r">A pagar</th><th class="r">Vencido</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="hint" style="margin-top:10px">Os saldos são de cada empresa separadamente — não há soma de caixa entre clientes diferentes.</div>`;
    $('dashArea').querySelectorAll('[data-co]').forEach(tr=>tr.onclick=()=>dashSelectCompany(tr.dataset.co));
  }catch(err){ $('dashArea').innerHTML=`<div class="panel"><div class="empty">Não foi possível carregar.<br><small>${esc(err.message||err)}</small></div></div>`; }
}
async function renderDashboard(){
  if(!companyId) return renderDashboardConsolidado();
  const m=$('main');
  m.innerHTML=`<div class="page-h"><h1>Dashboard</h1><span class="scope">${esc(coName(companyId))}</span></div>
    <div class="updated">Atualizado agora · ${new Date().toLocaleString('pt-BR')}</div>
    <div id="dashArea"><div class="loading">Carregando dados…</div></div>`;
  try{
    const vw=(t,sit,asc)=>db.from(t).select('saldo,situacao,vencimento,descricao').eq('company_id',companyId).eq('situacao',sit).order('vencimento',{ascending:asc}).limit(8);
    const [res,pR,pP,vR,vP]=await Promise.all([
      db.rpc('resumo_financeiro',{ p_company:companyId }),
      vw('vw_contas_receber','a_vencer',true), vw('vw_contas_pagar','a_vencer',true),
      vw('vw_contas_receber','vencido',true),  vw('vw_contas_pagar','vencido',true),
    ]);
    for(const r of [res,pR,pP,vR,vP]) if(r.error) throw r.error;
    const z=(res.data||[])[0]||{}, N=k=>Number(z[k]||0);
    const saldoAtual=N('saldo'), aReceber=N('receber_aberto'), aPagar=N('pagar_aberto');
    const vencR=N('receber_vencido'), vencP=N('pagar_vencido'), recebPrev=N('receber_30d'), pagPrev=N('pagar_30d');
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
    const prox=[...(pR.data||[]).map(r=>({tipo:'receber',...r})),...(pP.data||[]).map(p=>({tipo:'pagar',...p}))]
      .sort((a,b)=>a.vencimento.localeCompare(b.vencimento)).slice(0,8);
    const venc=[...(vR.data||[]).map(r=>({tipo:'receber',...r})),...(vP.data||[]).map(p=>({tipo:'pagar',...p}))]
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
