/* ===================== CONTROLADORIA — INDICADORES ===================== */
let indCo='', indAno=new Date().getFullYear(), indMes=0, indMetas={};
const IND_ORDER=['faturamento','receita_liquida','custos','despesas','lucro','margem_liquida','fluxo_caixa','saldo','inadimplencia','ticket_medio','pmr','pmp'];
const IND_NOME={faturamento:'Faturamento',receita_liquida:'Receita líquida',despesas:'Despesas',custos:'Custos',lucro:'Lucro',margem_liquida:'Margem líquida',inadimplencia:'Inadimplência',ticket_medio:'Ticket médio',pmr:'Prazo médio recebimento',pmp:'Prazo médio pagamento',saldo:'Saldo atual',fluxo_caixa:'Fluxo de caixa (período)'};
const IND_UNID={faturamento:'moeda',receita_liquida:'moeda',despesas:'moeda',custos:'moeda',lucro:'moeda',margem_liquida:'percent',inadimplencia:'percent',ticket_medio:'moeda',pmr:'dias',pmp:'dias',saldo:'moeda',fluxo_caixa:'moeda'};
const fmtInd=(k,v)=> IND_UNID[k]==='percent'?(v==null?'—':v.toFixed(1)+'%') : IND_UNID[k]==='dias'?(v==null?'—':Math.round(v)+' dias') : money(v);

async function renderIndicadores(){
  indCo=companyId||'';
  $('main').innerHTML=`<div class="page-h"><h1>Indicadores</h1><div class="spacer"></div>
    <button class="btn ghost" id="btnMetas">Definir metas</button></div>
    <div class="updated">Indicadores financeiros do período. Saldo e inadimplência são a foto de agora.</div>
    <div class="filters">
      <div class="fg"><label>Empresa</label><select id="inCo"><option value="">Todas as empresas</option>${companies.map(c=>`<option value="${c.id}" ${c.id===indCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="fg"><label>Ano</label><input id="inAno" type="number" value="${indAno}" style="max-width:110px"></div>
      <div class="fg"><label>Período</label><select id="inMes"><option value="0">Ano todo</option>${MES3.map((m,i)=>`<option value="${i+1}">${MESNOME[i]}</option>`).join('')}</select></div>
    </div>
    <div id="inArea"><div class="loading">Calculando…</div></div>`;
  $('btnMetas').onclick=openMetas;
  $('inCo').onchange=e=>{indCo=e.target.value;loadIndicadores();};
  $('inAno').onchange=e=>{indAno=+e.target.value||indAno;loadIndicadores();};
  $('inMes').onchange=e=>{indMes=+e.target.value;loadIndicadores();};
  await loadIndicadores();
}
function coFilter(q){ return indCo?q.eq('company_id',indCo):q; }
async function loadIndicadores(){
  $('inArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    await loadDreBase(); // dreCatNat = categoria -> natureza
    const ano=indAno, ini=ano+'-01-01', fim=ano+'-12-31';
    const [rec,pag,vwR,vwP,bankAll,accs,metas]=await Promise.all([
      coFilter(db.from('receivable_installments').select('valor,competencia,status,receivable_id, receivables(categoria_id)')).gte('competencia',ini).lte('competencia',fim),
      coFilter(db.from('payable_installments').select('valor,competencia,status, payables(categoria_id)')).gte('competencia',ini).lte('competencia',fim),
      coFilter(db.from('vw_contas_receber').select('saldo,valor,situacao')),
      coFilter(db.from('vw_contas_pagar').select('saldo,situacao')),
      coFilter(db.from('bank_transactions').select('tipo,valor,data')),
      coFilter(db.from('financial_accounts').select('saldo_inicial')),
      indCo?db.from('indicator_targets').select('*').eq('company_id',indCo).eq('ano',ano).is('mes',null):Promise.resolve({data:[]}),
    ]);
    const inPer=comp=>comp && (indMes===0 || (+comp.slice(5,7))===indMes);
    const N={receita_bruta:0,deducao:0,custo:0,despesa_operacional:0,imposto:0,resultado_financeiro:0};
    const titulos=new Set();
    (rec.data||[]).forEach(r=>{ if(r.status==='cancelado'||!inPer(r.competencia))return; const n=dreCatNat[r.receivables&&r.receivables.categoria_id]; if(n&&N[n]!==undefined)N[n]+=Number(r.valor||0); titulos.add(r.receivable_id); });
    (pag.data||[]).forEach(p=>{ if(p.status==='cancelado'||!inPer(p.competencia))return; const n=dreCatNat[p.payables&&p.payables.categoria_id]; if(n&&N[n]!==undefined)N[n]+=Number(p.valor||0); });

    const faturamento=N.receita_bruta;
    const receita_liquida=N.receita_bruta-N.deducao;
    const custos=N.custo, despesas=N.despesa_operacional;
    const lucro=receita_liquida-custos-despesas+N.resultado_financeiro-N.imposto;
    const margem_liquida=receita_liquida!==0?(lucro/receita_liquida*100):null;
    const ticket_medio=titulos.size?faturamento/titulos.size:0;

    // snapshot
    const abertoR=(vwR.data||[]).filter(r=>!['recebido','cancelado'].includes(r.situacao));
    const receberAberto=abertoR.reduce((s,r)=>s+Number(r.saldo||0),0);
    const vencidoR=(vwR.data||[]).filter(r=>r.situacao==='vencido').reduce((s,r)=>s+Number(r.saldo||0),0);
    const totalR=receberAberto; const inadimplencia=totalR>0?(vencidoR/totalR*100):0;
    const pagarAberto=(vwP.data||[]).filter(p=>!['pago','cancelado'].includes(p.situacao)).reduce((s,p)=>s+Number(p.saldo||0),0);
    const saldoInicial=(accs.data||[]).reduce((s,a)=>s+Number(a.saldo_inicial||0),0);
    const entradasAll=(bankAll.data||[]).filter(t=>t.tipo==='entrada').reduce((s,t)=>s+Number(t.valor),0);
    const saidasAll=(bankAll.data||[]).filter(t=>t.tipo==='saida').reduce((s,t)=>s+Number(t.valor),0);
    const saldo=saldoInicial+entradasAll-saidasAll;
    const inPerData=d=>d && (+d.slice(0,4)===ano) && (indMes===0||(+d.slice(5,7))===indMes);
    const entP=(bankAll.data||[]).filter(t=>t.tipo==='entrada'&&inPerData(t.data)).reduce((s,t)=>s+Number(t.valor),0);
    const saiP=(bankAll.data||[]).filter(t=>t.tipo==='saida'&&inPerData(t.data)).reduce((s,t)=>s+Number(t.valor),0);
    const fluxo_caixa=entP-saiP;
    const dias=indMes===0?365:30;
    const pmr=faturamento>0?(receberAberto/faturamento*dias):null;
    const pmp=(custos+despesas)>0?(pagarAberto/(custos+despesas)*dias):null;

    const val={faturamento,receita_liquida,custos,despesas,lucro,margem_liquida,inadimplencia,ticket_medio,pmr,pmp,saldo,fluxo_caixa};
    indMetas={}; (metas.data||[]).forEach(m=>indMetas[m.indicador]={id:m.id,meta:Number(m.meta)});

    const cards=IND_ORDER.map(k=>{
      const v=val[k]; const meta=indMetas[k];
      let metaHtml='';
      if(meta && indMes===0 && IND_UNID[k]!=='dias'){
        const pct=meta.meta!==0?(v/meta.meta*100):null;
        metaHtml=`<div class="meta">Meta: ${fmtInd(k,meta.meta)}${pct!=null?` · ${pct.toFixed(0)}% atingido`:''}</div>
          <div class="metabar"><span style="width:${Math.max(0,Math.min(100,pct||0))}%"></span></div>`;
      }
      return `<div class="kpi"><div class="lbl">${IND_NOME[k]}</div><div class="val ${(k==='lucro'||k==='fluxo_caixa'||k==='saldo')&&v<0?'neg':''}">${fmtInd(k,v)}</div>${metaHtml}</div>`;
    }).join('');
    const per=indMes===0?('Ano '+ano):(MESNOME[indMes-1]+'/'+ano);
    $('inArea').innerHTML=`<div class="updated" style="margin-bottom:8px">Período: <b>${per}</b>${indCo?'':' · consolidado'}</div><div class="cards">${cards}</div>`;
  }catch(err){ $('inArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
function openMetas(){
  if(!indCo){ toast('Selecione uma empresa para definir metas.','err'); return; }
  const rows=IND_ORDER.filter(k=>IND_UNID[k]!=='dias').map(k=>{
    const m=indMetas[k];
    return `<tr><td>${IND_NOME[k]} <span style="color:var(--muted);font-size:11px">(${IND_UNID[k]==='percent'?'%':'R$'})</span></td>
      <td><input data-meta="${k}" type="number" step="0.01" value="${m?m.meta:''}" style="width:130px"></td></tr>`;
  }).join('');
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>Metas anuais — ${indAno}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="hint" style="margin-bottom:10px">Metas anuais por indicador. Deixe em branco pra não ter meta.</div>
      <table><tbody>${rows}</tbody></table></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar metas</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  $('mSave').onclick=async ()=>{
    $('mSave').disabled=true; $('mSave').textContent='Salvando…';
    try{
      for(const inp of document.querySelectorAll('#modalRoot [data-meta]')){
        const k=inp.dataset.meta; const cur=indMetas[k]; const raw=inp.value.trim();
        if(raw===''){ if(cur){ await db.from('indicator_targets').delete().eq('id',cur.id); } continue; }
        const meta=num(raw);
        if(cur){ await db.from('indicator_targets').update({meta}).eq('id',cur.id); }
        else { await db.from('indicator_targets').insert({company_id:indCo,indicador:k,ano:indAno,mes:null,meta}); }
      }
      closeModal(); toast('Metas salvas!'); loadIndicadores();
    }catch(err){ toast('Erro: '+(err.message||err),'err'); $('mSave').disabled=false; $('mSave').textContent='Salvar metas'; }
  };
}