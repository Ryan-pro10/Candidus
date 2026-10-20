/* ===================== IMPORTAR EXTRATO (OFX/CSV) ===================== */
let impRows=[], impCard={};
function parseDateFlex(s){
  s=(s||'').trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/); if(m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m=s.match(/^(\d{8})/); if(m) return `${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`;
  return null;
}
function parseValorBR(s){
  s=(s||'').replace(/[R$\s]/g,'');
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); // 1.234,56 -> 1234.56
  const n=parseFloat(s); return isNaN(n)?NaN:n;
}
function parseOFX(text){
  const out=[]; const blocks=text.split(/<STMTTRN>/i).slice(1);
  for(const raw of blocks){
    const b=raw.split(/<\/STMTTRN>/i)[0];
    const get=t=>{ const m=b.match(new RegExp('<'+t+'>([^<\\r\\n]*)','i')); return m?m[1].trim():''; };
    const dt=parseDateFlex(get('DTPOSTED')); const amt=parseFloat((get('TRNAMT')||'').replace(',','.'));
    if(!dt||isNaN(amt)) continue;
    out.push({data:dt, descricao:get('MEMO')||get('NAME')||'(sem descrição)', documento:get('CHECKNUM')||'', valor:Math.abs(amt), tipo:amt<0?'saida':'entrada', fit_id:get('FITID')||''});
  }
  return out;
}
function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return [];
  const delim=(lines[0].split(';').length>lines[0].split(',').length)?';':',';
  let start=0, ci={data:0,desc:1,valor:2};
  if(/data|valor|hist|descri|lan/i.test(lines[0])){
    const h=lines[0].split(delim).map(x=>x.trim().toLowerCase());
    ci.data=h.findIndex(x=>/data/.test(x)); ci.desc=h.findIndex(x=>/hist|descri|lan|memo/.test(x)); ci.valor=h.findIndex(x=>/valor|vlr|montante|amount/.test(x));
    if(ci.data<0)ci.data=0; if(ci.desc<0)ci.desc=1; if(ci.valor<0)ci.valor=2; start=1;
  }
  const out=[];
  for(let i=start;i<lines.length;i++){
    const c=lines[i].split(delim); const data=parseDateFlex(c[ci.data]); const valor=parseValorBR(c[ci.valor]);
    if(!data||isNaN(valor)) continue;
    out.push({data, descricao:(c[ci.desc]||'').trim()||'(sem descrição)', documento:'', valor:Math.abs(valor), tipo:valor<0?'saida':'entrada', fit_id:''});
  }
  return out;
}

async function renderImportar(){
  const defaultCo=companyId||(companies[0]&&companies[0].id)||'';
  $('main').innerHTML=`<div class="page-h"><h1>Importar extrato</h1><div class="spacer"></div></div>
    <div class="updated">Importe o extrato do banco (OFX ou CSV). O sistema confere duplicidades antes de lançar.</div>
    <div class="panel" style="padding:18px;margin-bottom:16px"><div class="cadgrid">
      <div class="field"><label>Empresa *</label><select id="impCo">${companies.map(c=>`<option value="${c.id}" ${c.id===defaultCo?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Conta financeira *</label><select id="impAcc"><option value="">—</option></select></div>
      <div class="field" style="grid-column:1/3"><label>Arquivo (.ofx ou .csv) *</label><input id="impFile" type="file" accept=".ofx,.csv,.txt"></div>
    </div>
    <div style="margin-top:12px"><button class="btn" id="impLer">Ler arquivo</button></div></div>
    <div id="impArea"></div>`;
  async function loadAcc(co){ const { data }=await db.from('financial_accounts').select('id,nome,tipo').eq('company_id',co).neq('tipo','cartao_credito').order('nome');
    $('impAcc').innerHTML='<option value="">—</option>'+(data||[]).map(a=>`<option value="${a.id}">${esc(a.nome)}</option>`).join(''); }
  await loadAcc(defaultCo);
  $('impCo').onchange=()=>loadAcc($('impCo').value);
  $('impLer').onclick=lerExtrato;
}
async function lerExtrato(){
  const co=$('impCo').value, acc=$('impAcc').value, f=$('impFile').files[0];
  if(!acc){ toast('Escolha a conta financeira.','err'); return; }
  if(!f){ toast('Selecione o arquivo.','err'); return; }
  impCard={co,acc,nome:f.name,origem:f.name.toLowerCase().endsWith('.ofx')?'ofx':'csv'};
  $('impArea').innerHTML='<div class="loading">Lendo e conferindo…</div>';
  const text=await f.text();
  let rows = impCard.origem==='ofx'?parseOFX(text):parseCSV(text);
  if(!rows.length && impCard.origem==='csv'){ rows=parseOFX(text); if(rows.length) impCard.origem='ofx'; }
  if(!rows.length){ $('impArea').innerHTML='<div class="panel"><div class="empty">Não consegui ler movimentos nesse arquivo. Se for CSV, confira se tem colunas de Data, Descrição e Valor. OFX costuma funcionar direto.</div></div>'; return; }

  // dedup: contra bank_transactions existentes (data+valor) e imports anteriores (hash/fit)
  const datas=rows.map(r=>r.data).sort();
  const { data:bt }=await db.from('bank_transactions').select('data,valor,tipo').eq('financial_account_id',acc).gte('data',datas[0]).lte('data',datas[datas.length-1]);
  const btSet=new Set((bt||[]).map(x=>`${x.data}|${Number(x.valor).toFixed(2)}|${x.tipo}`));
  const { data:imp }=await db.from('imported_transactions').select('hash,fit_id,status').eq('financial_account_id',acc).in('status',['importada']);
  const impHash=new Set((imp||[]).map(x=>x.hash)); const impFit=new Set((imp||[]).filter(x=>x.fit_id).map(x=>x.fit_id));

  impRows=rows.map(r=>{
    r.hash=`${acc}|${r.data}|${r.valor.toFixed(2)}|${normDesc(r.descricao)}`;
    let status='nova';
    if((r.fit_id && impFit.has(r.fit_id)) || impHash.has(r.hash)) status='duplicada';
    else if(btSet.has(`${r.data}|${r.valor.toFixed(2)}|${r.tipo}`)) status='possivel_duplicada';
    r.status=status; r.importar=(status==='nova'); return r;
  });
  drawImport();
}
function drawImport(){
  const novas=impRows.filter(r=>r.status==='nova').length, pos=impRows.filter(r=>r.status==='possivel_duplicada').length, dup=impRows.filter(r=>r.status==='duplicada').length;
  const STL={nova:['Nova','st-recebido'],possivel_duplicada:['Possível duplicada','st-recebido_parcial'],duplicada:['Duplicada','st-vencido']};
  const body=impRows.map((r,i)=>`<tr>
    <td><input type="checkbox" data-imp="${i}" ${r.importar?'checked':''} style="width:16px;height:16px"></td>
    <td>${fmtDate(r.data)}</td><td>${esc(r.descricao)}</td>
    <td class="r" style="color:var(--green)">${r.tipo==='entrada'?money(r.valor):''}</td>
    <td class="r" style="color:var(--red)">${r.tipo==='saida'?money(r.valor):''}</td>
    <td><span class="pill ${STL[r.status][1]}">${STL[r.status][0]}</span></td></tr>`).join('');
  $('impArea').innerHTML=`<div class="box" style="margin-bottom:12px">Arquivo: <b>${esc(impCard.nome)}</b> · ${impRows.length} movimentos · <span style="color:var(--green)">${novas} novas</span> · <span style="color:var(--amber)">${pos} possíveis duplicadas</span> · <span style="color:var(--red)">${dup} duplicadas</span></div>
    <div class="panel"><table><thead><tr><th>Importar</th><th>Data</th><th>Descrição</th><th class="r">Entrada</th><th class="r">Saída</th><th>Situação</th></tr></thead><tbody>${body}</tbody></table></div>
    <div style="margin-top:14px;display:flex;gap:10px"><button class="btn" id="impConfirm">Importar selecionados</button>
      <button class="btn ghost" id="impAll">Marcar todas as novas</button></div>`;
  $('impArea').querySelectorAll('[data-imp]').forEach(c=>c.onchange=()=>{ impRows[+c.dataset.imp].importar=c.checked; });
  $('impAll').onclick=()=>{ impRows.forEach(r=>r.importar=(r.status!=='duplicada')); drawImport(); };
  $('impConfirm').onclick=confirmarImport;
}
async function confirmarImport(){
  const sel=impRows.filter(r=>r.importar);
  if(!sel.length){ toast('Nenhum movimento marcado.','err'); return; }
  const btn=$('impConfirm'); btn.disabled=true; btn.textContent='Importando…';
  try{
    const datas=impRows.map(r=>r.data).sort();
    const { data:batch,error:be }=await db.from('import_batches').insert({ company_id:impCard.co, financial_account_id:impCard.acc, origem:impCard.origem, nome_arquivo:impCard.nome, periodo_inicio:datas[0], periodo_fim:datas[datas.length-1], qtd_total:impRows.length, qtd_importadas:sel.length, qtd_duplicadas:impRows.filter(r=>r.status==='duplicada').length, created_by:userId }).select('id').single();
    if(be) throw be;
    // cria os movimentos bancários
    const bts=sel.map(r=>({ company_id:impCard.co, financial_account_id:impCard.acc, tipo:r.tipo, descricao:r.descricao, valor:r.valor, data:r.data, forma:'extrato', origem:'importado' }));
    const { data:btIns,error:bte }=await db.from('bank_transactions').insert(bts).select('id');
    if(bte) throw bte;
    // registra imported_transactions (importadas com link + não-marcadas como ignoradas/duplicadas)
    const regs=[];
    let k=0;
    for(const r of impRows){
      if(r.importar){ regs.push({ batch_id:batch.id, company_id:impCard.co, financial_account_id:impCard.acc, data:r.data, descricao:r.descricao, documento:r.documento||null, valor:r.valor, tipo:r.tipo, fit_id:r.fit_id||null, hash:r.hash, status:'importada', bank_transaction_id:btIns[k]?btIns[k].id:null }); k++; }
      else { regs.push({ batch_id:batch.id, company_id:impCard.co, financial_account_id:impCard.acc, data:r.data, descricao:r.descricao, documento:r.documento||null, valor:r.valor, tipo:r.tipo, fit_id:r.fit_id||null, hash:r.hash, status:(r.status==='duplicada'?'duplicada':'ignorada') }); }
    }
    await db.from('imported_transactions').insert(regs);
    // regras automáticas (tarifas, transferências etc.) só nos movimentos que acabaram de entrar
    let porRegra=0, errRegra=0;
    const ap=await db.rpc('aplicar_regras_conciliacao',{ p_company:impCard.co, p_bank_transaction_ids:(btIns||[]).map(x=>x.id), p_somente_auto:true });
    if(!ap.error && ap.data){ porRegra=ap.data.aplicados||0; errRegra=ap.data.erros||0; }
    btn.disabled=false; btn.textContent='Importar selecionados';
    toast(sel.length+' movimento(s) importado(s)!'+(porRegra?` ${porRegra} resolvido(s) por regra.`:''));
    $('impArea').innerHTML=`<div class="panel"><div class="empty">✅ ${sel.length} movimentos lançados na conta.`+
      (porRegra?`<br>⚡ ${porRegra} já resolvido(s) automaticamente pelas regras.`:'')+
      (errRegra?`<br>⚠️ ${errRegra} regra(s) deram erro — confira na Conciliação.`:'')+
      `<br>Os demais estão esperando na <b>Conciliação</b>.</div></div>`;
  }catch(err){ btn.disabled=false; btn.textContent='Importar selecionados'; toast('Erro: '+(err.message||err),'err'); }
}
