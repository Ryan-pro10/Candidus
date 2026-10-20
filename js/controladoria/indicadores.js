/* ===================== CONTROLADORIA — INDICADORES ===================== */
let indCo='', indAno=new Date().getFullYear(), indMes=0, indMetas={};
const IND_GRUPOS=[
  {t:'Resultado', k:['faturamento','receita_liquida','custos','despesas','lucro','crescimento']},
  {t:'Margens e equilíbrio', k:['margem_bruta','margem_contribuicao','margem_contribuicao_pct','custos_fixos','ponto_equilibrio','margem_seguranca','margem_operacional','margem_liquida']},
  {t:'Caixa e liquidez', k:['saldo','fluxo_caixa','liquidez','folego_caixa']},
  {t:'Prazos e risco', k:['pmr','pmp','inadimplencia','ticket_medio']},
];
const IND_ORDER=IND_GRUPOS.flatMap(g=>g.k);
const IND_NOME={faturamento:'Faturamento',receita_liquida:'Receita líquida',despesas:'Despesas operacionais',custos:'Custos',lucro:'Lucro líquido',
  margem_liquida:'Margem líquida',inadimplencia:'Inadimplência',ticket_medio:'Ticket médio',pmr:'Prazo médio recebimento',pmp:'Prazo médio pagamento',
  saldo:'Saldo atual',fluxo_caixa:'Fluxo de caixa (período)',margem_bruta:'Margem bruta',margem_operacional:'Margem operacional',
  crescimento:'Crescimento da receita',ponto_equilibrio:'Ponto de equilíbrio',liquidez:'Liquidez corrente',folego_caixa:'Fôlego de caixa',
  margem_contribuicao:'Margem de contribuição',margem_contribuicao_pct:'Margem de contribuição %',custos_fixos:'Custos e despesas fixos',margem_seguranca:'Margem de segurança'};
const IND_UNID={faturamento:'moeda',receita_liquida:'moeda',despesas:'moeda',custos:'moeda',lucro:'moeda',margem_liquida:'percent',inadimplencia:'percent',
  ticket_medio:'moeda',pmr:'dias',pmp:'dias',saldo:'moeda',fluxo_caixa:'moeda',margem_bruta:'percent',margem_operacional:'percent',crescimento:'percent',
  ponto_equilibrio:'moeda',liquidez:'indice',folego_caixa:'dias',margem_contribuicao:'moeda',margem_contribuicao_pct:'percent',custos_fixos:'moeda',margem_seguranca:'percent'};
const IND_DICA={
  faturamento:'Receita bruta do período (por competência).',
  receita_liquida:'Receita bruta − deduções.',
  custos:'Custos mapeados na DRE.',
  despesas:'Despesas operacionais mapeadas na DRE.',
  lucro:'Resultado líquido da DRE: receita líquida − custos − despesas ± resultado financeiro − impostos.',
  crescimento:'Receita bruta comparada com o mesmo período do ano anterior. No ano corrente, compara jan até o mês atual.',
  margem_bruta:'(Receita líquida − custos) ÷ receita líquida.',
  margem_operacional:'Resultado operacional ÷ receita líquida.',
  margem_liquida:'Lucro líquido ÷ receita líquida.',
  ponto_equilibrio:'Receita líquida necessária pra empatar: custos e despesas fixos ÷ margem de contribuição %. Exato quando todas as categorias estão classificadas como fixo/variável.',
  margem_contribuicao:'Receita líquida − custos e despesas variáveis. É o que sobra das vendas pra pagar os fixos e gerar lucro.',
  margem_contribuicao_pct:'Margem de contribuição ÷ receita líquida. De cada R$ 100 vendidos, quanto sobra pra cobrir os fixos.',
  custos_fixos:'Custos e despesas operacionais classificados como fixos.',
  margem_seguranca:'(Receita líquida − ponto de equilíbrio) ÷ receita líquida. Quanto as vendas podem cair antes de dar prejuízo.',
  saldo:'Saldo de hoje: saldos iniciais + entradas − saídas de todas as contas.',
  fluxo_caixa:'Entradas − saídas realizadas no período.',
  liquidez:'(Saldo + contas a receber em aberto) ÷ contas a pagar em aberto. Acima de 1 = cobre as obrigações.',
  folego_caixa:'Quantos dias o saldo atual aguenta, pela média de saídas dos últimos 3 meses fechados.',
  pmr:'Contas a receber em aberto ÷ faturamento × dias do período.',
  pmp:'Contas a pagar em aberto ÷ (custos + despesas) × dias do período.',
  inadimplencia:'Valor vencido a receber ÷ total a receber em aberto (foto de hoje).',
  ticket_medio:'Faturamento ÷ nº de títulos a receber do período.',
};
const fmtInd=(k,v)=>{ const u=IND_UNID[k];
  if(v==null||!isFinite(v)) return '—';
  if(u==='percent') return (k==='crescimento'&&v>0?'+':'')+v.toFixed(1).replace('.',',')+'%';
  if(u==='dias') return Math.round(v)+' dias';
  if(u==='indice') return v.toFixed(2).replace('.',',')+'×';
  return money(v); };
const indUnidLbl=k=>({percent:'%',dias:'dias',indice:'×',moeda:'R$'})[IND_UNID[k]];

async function renderIndicadores(){
  indCo=companyId||'';
  $('main').innerHTML=`<div class="page-h"><h1>Indicadores</h1><div class="spacer"></div>
    <button class="btn ghost" id="btnMetas">Definir metas</button></div>
    <div class="updated">Indicadores do período. Saldo, liquidez, fôlego e inadimplência são a foto de hoje. Passe o mouse num card pra ver a fórmula.</div>
    <div class="filters">
      <div class="fg"><label>Empresa</label><select id="inCo"><option value="">Todas as empresas</option>${companies.map(c=>`<option value="${c.id}" ${c.id===indCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="fg"><label>Ano</label><input id="inAno" type="number" value="${indAno}" style="max-width:110px"></div>
      <div class="fg"><label>Período</label><select id="inMes"><option value="0">Ano todo</option>${MES3.map((m,i)=>`<option value="${i+1}" ${indMes===i+1?'selected':''}>${MESNOME[i]}</option>`).join('')}</select></div>
    </div>
    <div id="inArea"><div class="loading">Calculando…</div></div>`;
  $('btnMetas').onclick=openMetas;
  $('inCo').onchange=e=>{indCo=e.target.value;loadIndicadores();};
  $('inAno').onchange=e=>{indAno=+e.target.value||indAno;loadIndicadores();};
  $('inMes').onchange=e=>{indMes=+e.target.value;loadIndicadores();};
  await loadIndicadores();
}
function coFilter(q){ return indCo?q.eq('company_id',indCo):q; }
// soma natureza → valor dentro de [ini, fim] (meses 'YYYY-MM-01')
function indNat(data, ini, fim){
  const N={receita_bruta:0,deducao:0,custo:0,despesa_operacional:0,imposto:0,resultado_financeiro:0};
  data.forEach(d=>{ if(!d.natureza||N[d.natureza]===undefined||d.mes<ini||d.mes>fim) return; N[d.natureza]+=dreValor(d); });
  const rl=N.receita_bruta-N.deducao, lb=rl-N.custo, ro=lb-N.despesa_operacional, ll=ro+N.resultado_financeiro-N.imposto;
  return {...N, rl, lb, ro, ll};
}
const indPct=(a,b)=>b?a/b*100:null;
async function loadIndicadores(){
  $('inArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    const ano=indAno, hoje=todayStr(), anoAtual=+hoje.slice(0,4), mesAtual=+hoje.slice(5,7);
    const pIni=mesIni(ano, indMes||1), pFim=mesIni(ano, indMes||12);
    const co=indCo||null;
    const [realiz,res,fm,tit,metas]=await Promise.all([
      dreRealizado(co, mesIni(ano-1,1), mesIni(ano,12)),
      db.rpc('resumo_financeiro',{p_company:co}),
      db.rpc('fluxo_mensal',{p_company:co}),
      db.rpc('contar_titulos_receber',{p_company:co, p_ini:pIni, p_fim:pFim}),
      indCo?db.from('indicator_targets').select('*').eq('company_id',indCo).eq('ano',ano).is('mes',null):Promise.resolve({data:[]}),
    ]);
    for(const r of [res,fm,tit]) if(r.error) throw r.error;

    const D=indNat(realiz,pIni,pFim);
    // crescimento: mesmo recorte do ano anterior (no ano corrente, "ano todo" = jan até o mês atual)
    const cIni=pIni, cFim=(indMes===0 && ano===anoAtual)?mesIni(ano,mesAtual):pFim;
    const Dc=indNat(realiz,cIni,cFim), Dp=indNat(realiz,mesIni(ano-1,+cIni.slice(5,7)),mesIni(ano-1,+cFim.slice(5,7)));

    const R=(res.data||[]).reduce((s,x)=>{ ['saldo','receber_aberto','receber_vencido','pagar_aberto'].forEach(k=>s[k]+=Number(x[k]||0)); return s; },{saldo:0,receber_aberto:0,receber_vencido:0,pagar_aberto:0});
    const F=fm.data||[];
    const ymP=[pIni.slice(0,7), pFim.slice(0,7)];
    const fluxo_caixa=F.filter(x=>x.ym>=ymP[0]&&x.ym<=ymP[1]).reduce((s,x)=>s+Number(x.real_e)-Number(x.real_s),0);
    // fôlego: média de saídas dos 3 meses fechados antes do mês atual
    const ult3=[1,2,3].map(n=>{ const [a,m]=addMes(anoAtual,mesAtual,-n); return `${a}-${String(m).padStart(2,'0')}`; });
    const saidaMedia=F.filter(x=>ult3.includes(x.ym)).reduce((s,x)=>s+Number(x.real_s),0)/3;
    const dias=indMes===0?365:30;
    const CV=indCV(realiz,pIni,pFim), mcVal=D.rl-CV.variavel, mcPct=D.rl?mcVal/D.rl:null;
    const pe=(mcPct&&mcPct>0)?CV.fixo/mcPct:null;
    const titulos=Number(tit.data||0);

    const val={
      faturamento:D.receita_bruta, receita_liquida:D.rl, custos:D.custo, despesas:D.despesa_operacional, lucro:D.ll,
      crescimento:Dp.receita_bruta?(Dc.receita_bruta-Dp.receita_bruta)/Math.abs(Dp.receita_bruta)*100:null,
      margem_bruta:indPct(D.lb,D.rl), margem_operacional:indPct(D.ro,D.rl), margem_liquida:indPct(D.ll,D.rl),
      ponto_equilibrio:pe, margem_contribuicao:mcVal, margem_contribuicao_pct:mcPct!=null?mcPct*100:null, custos_fixos:CV.fixo,
      margem_seguranca:(pe!=null&&D.rl)?(D.rl-pe)/D.rl*100:null,
      saldo:R.saldo, fluxo_caixa,
      liquidez:R.pagar_aberto>0?(R.saldo+R.receber_aberto)/R.pagar_aberto:null,
      folego_caixa:saidaMedia>0?Math.max(0,R.saldo)/(saidaMedia/30):null,
      pmr:D.receita_bruta>0?(R.receber_aberto/D.receita_bruta*dias):null,
      pmp:(D.custo+D.despesa_operacional)>0?(R.pagar_aberto/(D.custo+D.despesa_operacional)*dias):null,
      inadimplencia:R.receber_aberto>0?(R.receber_vencido/R.receber_aberto*100):0,
      ticket_medio:titulos?D.receita_bruta/titulos:0,
    };
    indMetas={}; (metas.data||[]).forEach(m=>indMetas[m.indicador]={id:m.id,meta:Number(m.meta)});

    const negRuim=['lucro','fluxo_caixa','saldo','margem_bruta','margem_operacional','margem_liquida','crescimento','margem_contribuicao','margem_contribuicao_pct','margem_seguranca'];
    const card=k=>{
      const v=val[k], meta=indMetas[k]; let extra='';
      if(meta && indMes===0 && IND_UNID[k]!=='dias'){
        const pct=meta.meta!==0&&v!=null?(v/meta.meta*100):null;
        extra=`<div class="meta">Meta: ${fmtInd(k,meta.meta)}${pct!=null?` · ${pct.toFixed(0)}% atingido`:''}</div>
          <div class="metabar"><span style="width:${Math.max(0,Math.min(100,pct||0))}%"></span></div>`;
      }
      if(k==='liquidez' && v!=null) extra+=`<div class="meta">${v>=1?'Cobre as contas em aberto':'Não cobre as contas em aberto'}</div>`;
      if(k==='ponto_equilibrio' && v!=null && D.rl) extra+=`<div class="meta">${D.rl>=v?'Acima':'Abaixo'} do equilíbrio (${(D.rl/v*100).toFixed(0)}%)${CV.semClass?' · estimado':''}</div>`;
      const cls=(negRuim.includes(k)&&v!=null&&v<0)?'neg':(k==='liquidez'&&v!=null&&v<1?'warn':'');
      return `<div class="kpi" title="${esc(IND_DICA[k])}"><div class="lbl">${IND_NOME[k]} <span class="ind-i">ⓘ</span></div><div class="val ${cls}">${fmtInd(k,v)}</div>${extra}</div>`;
    };
    const grupos=IND_GRUPOS.map(g=>`<div class="ind-grupo">${g.t}</div><div class="cards">${g.k.map(card).join('')}</div>`).join('');

    // gráficos do ano
    await loadDreBase();
    const meses=[...Array(12)].map((_,i)=>i+1);
    const porMes=meses.map(m=>indNat(realiz,mesIni(ano,m),mesIni(ano,m)));
    const ch1=svgChart({ labels:MES3, series:[
      {nome:'Receita líquida', cor:'var(--teal,#0d9488)', vals:porMes.map(x=>x.rl)},
      {nome:'Lucro líquido', cor:'var(--green)', corNeg:'var(--red)', vals:porMes.map(x=>x.ll)} ],
      line:{nome:'Margem líquida', cor:'var(--amber)', vals:porMes.map(x=>x.rl?x.ll/x.rl*100:null), fmt:v=>v.toFixed(0)+'%'} });
    const totalReal=F.reduce((s,x)=>s+Number(x.real_e)-Number(x.real_s),0);
    let acum=R.saldo-totalReal; // saldo antes do primeiro movimento
    F.filter(x=>x.ym<`${ano}-01`).forEach(x=>{ acum+=Number(x.real_e)-Number(x.real_s); });
    const fAno=meses.map(m=>F.find(x=>x.ym===`${ano}-${String(m).padStart(2,'0')}`)||{real_e:0,real_s:0});
    const saldoMes=fAno.map(x=>{ acum+=Number(x.real_e)-Number(x.real_s); return acum; });
    const ateHoje=meses.map(m=>ano<anoAtual||(ano===anoAtual&&m<=mesAtual));
    const ch2=svgChart({ labels:MES3, series:[
      {nome:'Entradas', cor:'var(--green)', vals:fAno.map(x=>Number(x.real_e))},
      {nome:'Saídas', cor:'var(--red)', vals:fAno.map(x=>Number(x.real_s))} ],
      line:{nome:'Saldo no fim do mês', cor:'var(--teal,#0d9488)', vals:saldoMes.map((v,i)=>ateHoje[i]?v:null), fmt:v=>moneyCurto(v)} });

    const per=indMes===0?('Ano '+ano):(MESNOME[indMes-1]+'/'+ano);
    const totCV=CV.variavel+CV.fixo;
    const lin=(t,v,cls,pct)=>`<tr class="${cls||''}"><td>${t}</td><td class="r ${v<0?'dre-neg':''}">${money(v)}</td><td class="r dre-av">${pct!=null&&isFinite(pct)?fmtPct(pct):''}</td></tr>`;
    const quadroMC=`<div class="panel" style="margin-top:18px"><h3><span class="dot t"></span>Margem de contribuição · ${per}</h3>
      ${CV.semClass?`<div class="box warnbox" style="margin-bottom:10px">⚠️ ${money(CV.semClass)} (${fmtPct(totCV?CV.semClass/totCV*100:0)} dos custos e despesas) em categorias <b>sem classificação</b>. Elas foram estimadas (custos como variáveis, despesas como fixas). Classifique em <b>Categorias → Fixo × variável</b> pra deixar exato.</div>`:''}
      <table class="dre-tbl"><thead><tr><th>Descrição</th><th class="r">Valor</th><th class="r">% receita líq.</th></tr></thead><tbody>
      ${lin('Receita líquida',D.rl,'dre-sub',D.rl?100:null)}
      ${lin('(−) Custos e despesas variáveis',CV.variavel,'',D.rl?CV.variavel/D.rl*100:null)}
      ${lin('(=) Margem de contribuição',mcVal,'dre-sub',mcPct!=null?mcPct*100:null)}
      ${lin('(−) Custos e despesas fixos',CV.fixo,'',D.rl?CV.fixo/D.rl*100:null)}
      ${lin('(=) Resultado operacional',mcVal-CV.fixo,'dre-sub',D.rl?(mcVal-CV.fixo)/D.rl*100:null)}
      </tbody></table>
      <div class="hint" style="margin-top:8px">${pe!=null?`Ponto de equilíbrio: <b>${money(pe)}</b> de receita líquida${CV.semClass?' (estimado)':''} · margem de segurança: <b>${fmtPct((D.rl-pe)/(D.rl||1)*100)}</b>`:'Sem margem de contribuição positiva no período: não há ponto de equilíbrio.'}</div></div>`;
    $('inArea').innerHTML=`<div class="updated" style="margin-bottom:8px">Período: <b>${per}</b>${indCo?'':' · consolidado'}</div>${grupos}${quadroMC}
      <div class="grid2" style="margin-top:18px">
        <div class="panel"><h3><span class="dot t"></span>Receita líquida × lucro · ${ano}</h3>${ch1}</div>
        <div class="panel"><h3><span class="dot t"></span>Entradas × saídas (realizado) · ${ano}</h3>${ch2}</div>
      </div>`;
  }catch(err){ $('inArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}
// gráfico de barras agrupadas (aceita negativo) + linha opcional com escala própria (eixo direito)
function svgChart({labels, series, line=null, h=240}){
  const W=Math.max(520, labels.length*52), H=h, pl=70, pr=line?62:14, pt=14, pb=26;
  const all=series.flatMap(s=>s.vals.map(Number).filter(isFinite));
  if(!all.some(v=>v!==0)) return '<div class="empty" style="padding:28px">Sem dados neste ano.</div>';
  let max=Math.max(0,...all), min=Math.min(0,...all); if(max===min) max=min+1;
  const pad=(max-min)*0.08; max+=max>0?pad:0; min-=min<0?pad:0;
  const y=v=>pt+(max-v)/(max-min)*(H-pt-pb);
  const gw=(W-pl-pr)/labels.length, bw=Math.min(20,(gw-12)/series.length);
  let g='';
  for(let i=0;i<=4;i++){ const v=min+(max-min)*i/4, yy=y(v);
    g+=`<line x1="${pl}" x2="${W-pr}" y1="${yy}" y2="${yy}" class="sc-grid"/><text x="${pl-8}" y="${yy+4}" class="sc-ax" text-anchor="end">${moneyCurto(v)}</text>`; }
  g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" class="sc-zero"/>`;
  labels.forEach((lb,i)=>{
    series.forEach((s,j)=>{ const v=Number(s.vals[i]||0); const x=pl+i*gw+(gw-bw*series.length)/2+j*bw;
      const top=y(Math.max(v,0)), hh=Math.max(v?1:0,Math.abs(y(v)-y(0)));
      g+=`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${hh.toFixed(1)}" rx="2" style="fill:${v<0&&s.corNeg?s.corNeg:s.cor}"><title>${esc(s.nome)} · ${esc(lb)}: ${money(v)}</title></rect>`; });
    g+=`<text x="${(pl+i*gw+gw/2).toFixed(1)}" y="${H-8}" class="sc-ax" text-anchor="middle">${esc(lb)}</text>`;
  });
  if(line){
    const lv=line.vals.map(v=>v==null||!isFinite(v)?null:Number(v)); const ok=lv.filter(v=>v!=null);
    if(ok.length){
      let lmax=Math.max(...ok), lmin=Math.min(...ok); if(lmax===lmin){ lmax+=1; lmin-=1; }
      const ly=v=>pt+(lmax-v)/(lmax-lmin)*(H-pt-pb);
      let path='', pen=false;
      lv.forEach((v,i)=>{ if(v==null){ pen=false; return; } const x=pl+i*gw+gw/2; path+=(pen?'L':'M')+x.toFixed(1)+' '+ly(v).toFixed(1)+' '; pen=true; });
      g+=`<path d="${path}" fill="none" style="stroke:${line.cor}" stroke-width="2.5"/>`;
      lv.forEach((v,i)=>{ if(v==null) return; const x=pl+i*gw+gw/2;
        g+=`<circle cx="${x.toFixed(1)}" cy="${ly(v).toFixed(1)}" r="3.5" style="fill:${line.cor}"><title>${esc(line.nome)} · ${esc(labels[i])}: ${line.fmt(v)}</title></circle>`; });
      [lmin,(lmin+lmax)/2,lmax].forEach(v=>{ g+=`<text x="${W-pr+6}" y="${ly(v)+4}" class="sc-ax">${line.fmt(v)}</text>`; });
    }
  }
  const leg=[...series.map(s=>`<span><span class="sc-dot" style="background:${s.cor}"></span>${esc(s.nome)}</span>`),
    line?`<span><span class="sc-dot sc-line" style="background:${line.cor}"></span>${esc(line.nome)} (eixo direito)</span>`:''].join('');
  return `<div class="sc-leg">${leg}</div><div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="sc-svg">${g}</svg></div>`;
}
function openMetas(){
  if(!indCo){ toast('Selecione uma empresa para definir metas.','err'); return; }
  const rows=IND_ORDER.filter(k=>IND_UNID[k]!=='dias').map(k=>{
    const m=indMetas[k];
    return `<tr><td>${IND_NOME[k]} <span style="color:var(--muted);font-size:11px">(${indUnidLbl(k)})</span></td>
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
