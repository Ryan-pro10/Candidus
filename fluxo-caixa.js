/* ===================== FLUXO DE CAIXA ===================== */
/* MES3, ymOf, ymLabel, ymAdd e monthsRange também são usados por Orçamento, R x O e Indicadores */
const MES3=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const ymOf = d => (d||'').slice(0,7);
const ymLabel = ym => { const [y,m]=ym.split('-'); return MES3[+m-1]+'/'+y.slice(2); };
function ymAdd(ym,n){ let [y,m]=ym.split('-').map(Number); m=m-1+n; y+=Math.floor(m/12); m=((m%12)+12)%12; return `${y}-${String(m+1).padStart(2,'0')}`; }
function monthsRange(keys){ if(!keys.length) return []; const s=keys.slice().sort(); let cur=s[0]; const end=s[s.length-1], out=[]; let guard=0; while(cur<=end && guard++<240){ out.push(cur); cur=ymAdd(cur,1);} return out; }

let fluxoData=null, fluxoMode='ambos'; let openFluxo=new Set();
async function renderFluxo(){
  $('main').innerHTML=`<div class="page-h"><h1>Fluxo de caixa</h1><span class="scope">${companyId?'':'· consolidado (todas as empresas)'}</span></div>
    <div class="updated">Saldo por mês. Alterne entre realizado, previsto e os dois juntos.</div>
    <div class="seg" style="max-width:520px;margin-bottom:20px">
      <button type="button" data-mode="realizado">Realizado</button>
      <button type="button" data-mode="previsto">Previsto</button>
      <button type="button" data-mode="ambos">Realizado + Previsto</button>
    </div>
    <div id="fluxoArea"><div class="loading">Carregando…</div></div>`;
  document.querySelectorAll('[data-mode]').forEach(b=>{
    if(b.dataset.mode===fluxoMode) b.classList.add('on');
    b.onclick=()=>{ fluxoMode=b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('on',x.dataset.mode===fluxoMode)); drawFluxo(); };
  });
  await loadFluxo();
}
async function loadFluxo(){
  try{
    const [acc,tx,rec,pag]=await Promise.all([
      scopeQ(db.from('financial_accounts').select('saldo_inicial,company_id')),
      scopeQ(db.from('bank_transactions').select('tipo,valor,data,descricao,company_id')),
      scopeQ(db.from('vw_contas_receber').select('saldo,situacao,vencimento,descricao,company_id')),
      scopeQ(db.from('vw_contas_pagar').select('saldo,situacao,vencimento,descricao,company_id')),
    ]);
    for(const r of [acc,tx,rec,pag]) if(r.error) throw r.error;
    const base=(acc.data||[]).reduce((s,x)=>s+Number(x.saldo_inicial||0),0);
    const realE={},realS={},prevE={},prevS={},movsReal=[],movsPrev=[];
    (tx.data||[]).forEach(t=>{
      const k=ymOf(t.data);
      if(t.tipo==='entrada'){ realE[k]=(realE[k]||0)+Number(t.valor); movsReal.push({ym:k,data:t.data,descricao:t.descricao||'Recebimento',valor:Number(t.valor),tipo:'entrada',origem:'realizado'}); }
      else if(t.tipo==='saida'){ realS[k]=(realS[k]||0)+Number(t.valor); movsReal.push({ym:k,data:t.data,descricao:t.descricao||'Pagamento',valor:Number(t.valor),tipo:'saida',origem:'realizado'}); }
    });
    const aberto=s=>!['recebido','pago','cancelado'].includes(s);
    (rec.data||[]).forEach(r=>{ if(aberto(r.situacao)&&Number(r.saldo)>0){ const k=ymOf(r.vencimento); prevE[k]=(prevE[k]||0)+Number(r.saldo); movsPrev.push({ym:k,data:r.vencimento,descricao:r.descricao||'A receber',valor:Number(r.saldo),tipo:'entrada',origem:'previsto'}); } });
    (pag.data||[]).forEach(p=>{ if(aberto(p.situacao)&&Number(p.saldo)>0){ const k=ymOf(p.vencimento); prevS[k]=(prevS[k]||0)+Number(p.saldo); movsPrev.push({ym:k,data:p.vencimento,descricao:p.descricao||'A pagar',valor:Number(p.saldo),tipo:'saida',origem:'previsto'}); } });
    fluxoData={base,realE,realS,prevE,prevS,movsReal,movsPrev};
    drawFluxo();
  }catch(err){
    $('fluxoArea').innerHTML=`<div class="panel"><div class="empty">Erro ao carregar.<br><small>${esc(err.message||err)}</small></div></div>`;
  }
}
function fluxoDetail(ym,movs){
  const list=movs.filter(m=>m.ym===ym).sort((a,b)=>a.data.localeCompare(b.data));
  if(!list.length) return '<div class="empty" style="padding:16px">Sem movimentos neste mês.</div>';
  return `<table style="margin:0"><tbody>${list.map(m=>`<tr class="inst-row">
    <td style="padding-left:38px;width:110px">${fmtDate(m.data)}</td>
    <td>${esc(m.descricao)}${m.origem==='previsto'?' <span class="pill st-a_vencer" style="margin-left:4px">previsto</span>':''}</td>
    <td class="r" style="width:150px;color:${m.tipo==='entrada'?'var(--green)':'var(--red)'}">${m.tipo==='entrada'?'+ ':'− '}${money(m.valor)}</td>
  </tr>`).join('')}</tbody></table>`;
}
function drawFluxo(){
  if(!fluxoData) return;
  const {base,realE,realS,prevE,prevS,movsReal,movsPrev}=fluxoData;
  const E={},S={};
  const add=(dst,src)=>{ for(const k in src) dst[k]=(dst[k]||0)+src[k]; };
  let detail;
  if(fluxoMode==='realizado'){ add(E,realE); add(S,realS); detail=movsReal; }
  else if(fluxoMode==='previsto'){ add(E,prevE); add(S,prevS); detail=movsPrev; }
  else { add(E,realE); add(E,prevE); add(S,realS); add(S,prevS); detail=[...movsReal,...movsPrev]; }

  const months=monthsRange([...new Set([...Object.keys(E),...Object.keys(S)])]);
  if(!months.length){ $('fluxoArea').innerHTML='<div class="panel"><div class="empty">Sem movimentos para exibir neste modo.</div></div>'; return; }

  let running=base, totE=0, totS=0;
  const linhas=months.map(ym=>{
    const e=E[ym]||0, s=S[ym]||0; totE+=e; totS+=s;
    const ini=running, fim=running+e-s; running=fim;
    return {ym,e,s,ini,fim};
  });
  const maxBar=Math.max(1,...linhas.map(l=>Math.max(l.e,l.s)));

  const kpis=`<div class="cards3">
    <div class="kpi"><div class="lbl"><span class="dot g"></span>Entradas no período</div><div class="val pos">${money(totE)}</div></div>
    <div class="kpi"><div class="lbl"><span class="dot r"></span>Saídas no período</div><div class="val neg">${money(totS)}</div></div>
    <div class="kpi"><div class="lbl"><span class="dot t"></span>Resultado do período</div><div class="val ${totE-totS<0?'neg':'pos'}">${money(totE-totS)}</div></div>
  </div>`;

  const chart=`<div class="panel" style="margin-bottom:16px"><h3><span class="dot t"></span>Entradas x Saídas por mês</h3>
    <div class="legend"><span><span class="dot g"></span>Entradas</span><span><span class="dot r"></span>Saídas</span></div>
    <div class="chart">${linhas.map(l=>`<div class="cbar-group">
      <div class="cbars">
        <div class="cbar e" style="height:${Math.round(l.e/maxBar*130)}px" title="Entradas ${money(l.e)}"></div>
        <div class="cbar s" style="height:${Math.round(l.s/maxBar*130)}px" title="Saídas ${money(l.s)}"></div>
      </div><div class="cbar-lbl">${ymLabel(l.ym)}</div></div>`).join('')}</div></div>`;

  const rowsHtml=linhas.map(l=>{
    const open=openFluxo.has(l.ym);
    const main=`<tr class="title-row" data-ym="${l.ym}">
      <td><span class="caret ${open?'open':''}">▶</span>${ymLabel(l.ym)}</td>
      <td class="r">${money(l.ini)}</td>
      <td class="r" style="color:var(--green)">${l.e?money(l.e):'—'}</td>
      <td class="r" style="color:var(--red)">${l.s?money(l.s):'—'}</td>
      <td class="r" style="font-weight:600;color:${l.fim<0?'var(--red)':'var(--ink)'}">${money(l.fim)}</td></tr>`;
    const det=open?`<tr><td colspan="5" style="padding:0;background:#f8fafb">${fluxoDetail(l.ym,detail)}</td></tr>`:'';
    return main+det;
  }).join('');

  const tabela=`<div class="panel"><h3><span class="dot t"></span>Fluxo mensal <span style="font-weight:400;color:var(--muted);font-size:12px">— clique no mês para ver os dias</span></h3>
    <table><thead><tr><th>Mês</th><th class="r">Saldo inicial</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Saldo final</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`;

  $('fluxoArea').innerHTML=kpis+chart+tabela;
  $('fluxoArea').querySelectorAll('tr.title-row').forEach(tr=>tr.onclick=()=>{
    const ym=tr.dataset.ym; openFluxo.has(ym)?openFluxo.delete(ym):openFluxo.add(ym); drawFluxo();
  });
}