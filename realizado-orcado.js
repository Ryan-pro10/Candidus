/* ===================== CONTROLADORIA — REALIZADO x ORÇADO ===================== */
let rxoCo='', rxoAno=new Date().getFullYear(), rxoMes=0; // mes 0 = ano todo
async function renderRxO(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||''; rxoCo=defaultCo;
  $('main').innerHTML=`<div class="page-h"><h1>Realizado x Orçado</h1><div class="spacer"></div></div>
    <div class="updated">Compara o orçado com o realizado (por competência), categoria a categoria.</div>
    <div class="filters">
      <div class="fg"><label>Empresa</label><select id="rxCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="fg"><label>Ano</label><input id="rxAno" type="number" value="${rxoAno}" style="max-width:110px"></div>
      <div class="fg"><label>Período</label><select id="rxMes"><option value="0">Ano todo (acumulado)</option>${MES3.map((m,i)=>`<option value="${i+1}">${MESNOME[i]}</option>`).join('')}</select></div>
    </div>
    <div id="rxArea"><div class="loading">Carregando…</div></div>`;
  $('rxCo').onchange=e=>{rxoCo=e.target.value;loadRxO();};
  $('rxAno').onchange=e=>{rxoAno=+e.target.value||rxoAno;loadRxO();};
  $('rxMes').onchange=e=>{rxoMes=+e.target.value;loadRxO();};
  await loadRxO();
}
async function loadRxO(){
  $('rxArea').innerHTML='<div class="loading">Calculando…</div>';
  try{
    const co=rxoCo, ano=rxoAno;
    const ini=ano+'-01-01', fim=ano+'-12-31';
    const [cats,maps,items,rec,pag]=await Promise.all([
      db.from('categories').select('id,nome,tipo').eq('company_id',co),
      db.from('dre_category_mappings').select('categoria_id').eq('company_id',co),
      db.from('budget_items').select('categoria_id,mes,valor_orcado').eq('company_id',co).eq('ano',ano),
      db.from('receivable_installments').select('valor,competencia,status, receivables(categoria_id)').eq('company_id',co).gte('competencia',ini).lte('competencia',fim),
      db.from('payable_installments').select('valor,competencia,status, payables(categoria_id)').eq('company_id',co).gte('competencia',ini).lte('competencia',fim),
    ]);
    const mapped=new Set((maps.data||[]).map(m=>m.categoria_id));
    const catInfo={}; (cats.data||[]).forEach(c=>{ if(mapped.has(c.id)) catInfo[c.id]={nome:c.nome,tipo:c.tipo}; });
    const inMes=comp=>{ if(!comp) return false; if(rxoMes===0) return true; return (+comp.slice(5,7))===rxoMes; };
    const orc={}, real={};
    (items.data||[]).forEach(it=>{ if(rxoMes!==0 && it.mes!==rxoMes) return; orc[it.categoria_id]=(orc[it.categoria_id]||0)+Number(it.valor_orcado); });
    const addReal=(cat,comp,valor,st)=>{ if(st==='cancelado'||!catInfo[cat]||!inMes(comp)) return; real[cat]=(real[cat]||0)+Number(valor||0); };
    (rec.data||[]).forEach(r=>addReal(r.receivables&&r.receivables.categoria_id, r.competencia, r.valor, r.status));
    (pag.data||[]).forEach(p=>addReal(p.payables&&p.payables.categoria_id, p.competencia, p.valor, p.status));

    const ids=Object.keys(catInfo).filter(id=>orc[id]||real[id]).sort((a,b)=>catInfo[a].nome.localeCompare(catInfo[b].nome));
    if(!ids.length){ $('rxArea').innerHTML='<div class="panel"><div class="empty">Sem dados de orçado ou realizado neste período. Lance o Orçamento e verifique o mapeamento da DRE.</div></div>'; return; }

    let tO=0,tR=0;
    const rows=ids.map(id=>{
      const o=orc[id]||0, r=real[id]||0; tO+=o; tR+=r;
      const dif=r-o; const pct=o!==0?(r/o*100):null;
      const rc=catInfo[id].tipo==='receita';
      // status: receita boa quando >= orçado; despesa boa quando <= orçado
      let stTxt,stCls;
      if(o===0){ stTxt='Sem orçamento'; stCls='ps-aberta'; }
      else if(rc){ if(r>=o){stTxt='Meta atingida';stCls='ps-resolvida';} else {stTxt='Abaixo da meta';stCls='ps-aguardando_cliente';} }
      else { if(r<=o){stTxt='Dentro do orçamento';stCls='ps-resolvida';} else {stTxt='Acima do orçamento';stCls='ps-cancelada';} }
      return `<tr><td>${esc(catInfo[id].nome)} <span class="pill ${rc?'st-recebido':'st-vencido'}" style="font-size:9px">${catInfo[id].tipo}</span></td>
        <td class="r">${money(o)}</td><td class="r">${money(r)}</td>
        <td class="r ${dif<0?'dre-neg':(dif>0?'dre-pos':'')}">${money(dif)}</td>
        <td class="r">${pct===null?'—':pct.toFixed(0)+'%'}</td>
        <td><span class="pill ${stCls}">${stTxt}</span></td></tr>`;
    }).join('');
    const difT=tR-tO, pctT=tO!==0?(tR/tO*100):null;
    const foot=`<tr class="dre-sub"><td>Total</td><td class="r">${money(tO)}</td><td class="r">${money(tR)}</td>
      <td class="r ${difT<0?'dre-neg':'dre-pos'}">${money(difT)}</td><td class="r">${pctT===null?'—':pctT.toFixed(0)+'%'}</td><td></td></tr>`;
    const per=rxoMes===0?('Ano '+ano):(MESNOME[rxoMes-1]+'/'+ano);
    $('rxArea').innerHTML=`<div class="panel"><h3><span class="dot t"></span>${per}</h3>
      <table><thead><tr><th>Categoria</th><th class="r">Orçado</th><th class="r">Realizado</th><th class="r">Diferença</th><th class="r">%</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>`;
  }catch(err){ $('rxArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}</div></div>`; }
}