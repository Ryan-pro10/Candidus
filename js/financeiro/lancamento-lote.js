/* ===================== LANÇAMENTO EM LOTE ===================== */
// "1.234,56" / "1234,56" / "1234.56" / "R$ 45" → número
function loteValor(s){
  s=String(s==null?'':s).trim().replace(/R\$|\s/g,'');
  if(!s) return NaN;
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  const n=Number(s); return isFinite(n)?n:NaN;
}
// "31/10/2026", "31/10/26", "2026-10-31" → "2026-10-31" ('' se inválida)
function loteData(s){
  s=String(s==null?'':s).trim(); let d='', m;
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  else if((m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/))) d=`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if(!d) return '';
  const t=new Date(d+'T00:00:00Z'); return (!isNaN(t) && t.toISOString().slice(0,10)===d)?d:'';
}
// acha fornecedor/cliente pelo nome colado
function acharContra(lista, nome){
  const n=normTxt(nome).trim(); if(!n) return null;
  const nm=x=>[normTxt(x.nome_fantasia||''),normTxt(x.razao_social||'')].filter(Boolean);
  return lista.find(x=>nm(x).some(v=>v===n)) || lista.find(x=>nm(x).some(v=>v.includes(n)||n.includes(v))) || null;
}
// texto colado (Excel/Sheets: colunas separadas por TAB, ou ;) → linhas
// colunas: Descrição | Valor | Vencimento | Fornecedor/Cliente (opc.) | Documento (opc.)
// separador da linha: TAB (Excel/Sheets) > ; > |
function sepColagem(l){ return l.includes('\t')?'\t':(l.includes(';')?';':(l.includes('|')?'|':null)); }
function parseColagem(txt){
  const linhas=String(txt||'').split(/\r?\n/).filter(l=>l.trim());
  return linhas.map(l=>{ const sep=sepColagem(l); const c=sep?l.split(sep).map(x=>x.trim()):[l.trim()];
      return {desc:c[0]||'', valor:loteValor(c[1]), venc:loteData(c[2]), contraNome:c[3]||'', doc:c[4]||'', semColunas:!sep}; })
    .filter((r,i)=>!(i===0 && linhas.length>1 && !/\d/.test(linhas[0]))); // pula cabeçalho (1ª linha sem nenhum número)
}
function loteLinhaVazia(r){ return !r.desc && !(r.valor>0) && !r.venc && !r.contra; }
function loteErros(r){
  const e=[]; if(!r.desc.trim()) e.push('desc'); if(!(r.valor>0)) e.push('valor'); if(!r.venc) e.push('venc');
  if(!(r.parc>=1 && r.parc<=360)) e.push('parc'); return e;
}
async function openLote(tipo){
  const pagar=tipo==='pagar';
  const contraLbl=pagar?'Fornecedor':'Cliente';
  const L={ co:companyId||(companies[0]&&companies[0].id)||'', cad:{contra:[],cat:[],cc:[],acc:[]}, rows:[], erroLinha:null };
  const novaLinha=()=>({contra:'',contraMiss:'',desc:'',doc:'',cat:'',cc:'',valor:NaN,venc:'',parc:1});
  for(let i=0;i<5;i++) L.rows.push(novaLinha());
  const carregar=async co=>{
    const [contra,cat,cc,acc]=await Promise.all([
      db.from(pagar?'suppliers':'customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
      db.from('categories').select('id,nome,default_cost_center_id').eq('company_id',co).eq('tipo',pagar?'despesa':'receita').order('nome'),
      db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
      db.from('financial_accounts').select('id,nome').eq('company_id',co).order('nome'),
    ]);
    L.cad={contra:contra.data||[],cat:cat.data||[],cc:cc.data||[],acc:acc.data||[]};
  };
  const opt=(arr,lbl,sel)=>'<option value="">—</option>'+arr.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(lbl(x))}</option>`).join('');
  const nomeC=x=>x.nome_fantasia||x.razao_social;
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal xl">
    <div class="modal-h"><h2>Lançamento em lote — contas a ${pagar?'pagar':'receber'}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b">
      <div class="lote-top">
        <div class="field"><label>Empresa</label><select id="ltCo" ${companyId?'disabled':''}>${companies.map(c=>`<option value="${c.id}" ${c.id===L.co?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
        <div class="field"><label>Conta financeira (todas)</label><select id="ltAcc"></select></div>
        <div class="field"><label>Forma de ${pagar?'pagamento':'recebimento'} (todas)</label><select id="ltForma"><option value="">—</option><option value="pix">PIX</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option><option value="outro">Outro</option></select></div>
        <div class="field"><label>Data de emissão (todas)</label><input id="ltEmis" type="date" value="${todayStr()}"></div>
      </div>
      <div class="box" style="margin:0 0 12px">
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin:0;min-width:180px"><label>Categoria</label><select id="ltCatAll"></select></div>
          <div class="field" style="margin:0;min-width:180px"><label>Centro de custo</label><select id="ltCCAll"></select></div>
          <div class="field" style="margin:0;min-width:180px"><label>${contraLbl}</label><select id="ltContraAll"></select></div>
          <button class="btn ghost" id="ltAplicar" style="margin-bottom:2px">Aplicar em todas as linhas</button>
          <div class="spacer" style="flex:1"></div>
          <button class="btn ghost" id="ltColarBtn" style="margin-bottom:2px">📋 Colar do Excel</button>
        </div>
        <div id="ltColarBox" style="display:none;margin-top:10px">
          <div class="hint" style="margin-bottom:6px">Copie as linhas direto da planilha e cole aqui (ou digite separando com <b>;</b> ou <b>|</b>). Colunas, nesta ordem: <b>Descrição · Valor · Vencimento</b> · ${contraLbl} (opcional) · Documento (opcional). Aceita 1.234,56 e 31/10/2026.</div>
          <textarea id="ltColar" rows="5" style="width:100%;font-family:monospace;font-size:12.5px" placeholder="Aluguel galpão ; 3.500,00 ; 10/11/2026 ; Imobiliária Silva ; NF 123"></textarea>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" id="ltColarOk">Adicionar linhas</button><button class="btn ghost" id="ltColarCancel">Fechar</button></div>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="lote-tbl"><thead><tr><th>#</th><th>${contraLbl}</th><th>Descrição *</th><th>Documento</th><th>Categoria</th><th>Centro de custo</th><th class="r">Valor total *</th><th>1º vencimento *</th><th title="O valor é o total; divide em parcelas mensais">Parc.</th><th></th></tr></thead><tbody id="ltBody"></tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="lnk" id="ltAdd">+ 1 linha</button><button class="lnk" id="ltAdd5">+ 5 linhas</button><button class="lnk" id="ltLimpar">Limpar vazias</button></div>
    </div>
    <div class="modal-f"><span id="ltResumo" style="margin-right:auto;font-size:13px;color:var(--muted)"></span><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Lançar</button></div>
  </div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  const resumo=()=>{
    const vals=L.rows.filter(r=>!loteLinhaVazia(r));
    const ok=vals.filter(r=>!loteErros(r).length);
    const tot=ok.reduce((t,r)=>t+r.valor,0);
    $('ltResumo').innerHTML=`${ok.length} linha(s) prontas${vals.length>ok.length?` · <span style="color:var(--red)">${vals.length-ok.length} incompleta(s)</span>`:''} · total <b>${money(tot)}</b>`;
    $('mSave').textContent=ok.length?`Lançar ${ok.length} conta(s)`:'Lançar';
  };
  const draw=()=>{
    $('ltBody').innerHTML=L.rows.map((r,i)=>{
      const err=(!loteLinhaVazia(r) && L.mostrarErros)?loteErros(r):[];
      const bad=k=>err.includes(k)?'lote-bad':'';
      return `<tr class="${L.erroLinha===i?'lote-errrow':''}">
      <td style="color:var(--muted)">${i+1}</td>
      <td><select data-f="contra" data-i="${i}" class="${r.contraMiss?'lote-warn':''}" title="${r.contraMiss?esc(contraLbl+' “'+r.contraMiss+'” não encontrado'):''}">${opt(L.cad.contra,nomeC,r.contra)}</select>${r.contraMiss?`<div class="lote-miss">não achei “${esc(r.contraMiss)}”</div>`:''}</td>
      <td><input data-f="desc" data-i="${i}" value="${esc(r.desc)}" class="${bad('desc')}" style="min-width:180px"></td>
      <td><input data-f="doc" data-i="${i}" value="${esc(r.doc)}" style="width:90px"></td>
      <td><select data-f="cat" data-i="${i}">${opt(L.cad.cat,x=>x.nome,r.cat)}</select></td>
      <td><select data-f="cc" data-i="${i}">${opt(L.cad.cc,x=>x.nome,r.cc)}</select></td>
      <td><input data-f="valor" data-i="${i}" value="${r.valor>0?String(r.valor.toFixed(2)).replace('.',','):''}" class="r ${bad('valor')}" style="width:100px" placeholder="0,00"></td>
      <td><input data-f="venc" data-i="${i}" type="date" value="${r.venc}" class="${bad('venc')}"></td>
      <td><input data-f="parc" data-i="${i}" type="number" min="1" max="360" value="${r.parc}" class="${bad('parc')}" style="width:56px"></td>
      <td><button class="lnk del" data-rm="${i}" title="Remover linha">✕</button></td></tr>`; }).join('');
    $('ltBody').querySelectorAll('[data-f]').forEach(el=>{
      const ev=el.tagName==='SELECT'||el.type==='date'?'onchange':'oninput';
      el[ev]=()=>{ const r=L.rows[+el.dataset.i], f=el.dataset.f;
        if(f==='valor') r.valor=loteValor(el.value);
        else if(f==='parc') r.parc=parseInt(el.value,10);
        else if(f==='cat'){ r.cat=el.value; const c=L.cad.cat.find(x=>x.id===r.cat), def=c&&c.default_cost_center_id;
          if(!r.cc||r.ccAuto){ r.cc=def||''; r.ccAuto=!!def; const ccSel=el.closest('tr').querySelector('[data-f="cc"]'); if(ccSel) ccSel.value=r.cc; } }
        else if(f==='cc'){ r.cc=el.value; r.ccAuto=false; }
        else { r[f]=el.value; if(f==='contra'){ r.contraMiss=''; el.classList.remove('lote-warn'); const m=el.nextElementSibling; if(m&&m.classList.contains('lote-miss')) m.remove(); } }
        resumo(); };
    });
    $('ltBody').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ L.rows.splice(+b.dataset.rm,1); if(!L.rows.length) L.rows.push(novaLinha()); L.erroLinha=null; draw(); });
    resumo();
  };
  const preencherTopo=()=>{
    $('ltAcc').innerHTML=opt(L.cad.acc,x=>x.nome,'');
    $('ltCatAll').innerHTML=opt(L.cad.cat,x=>x.nome,''); $('ltCCAll').innerHTML=opt(L.cad.cc,x=>x.nome,''); $('ltContraAll').innerHTML=opt(L.cad.contra,nomeC,'');
  };
  await carregar(L.co); preencherTopo(); draw();
  $('ltCo').onchange=async ()=>{
    L.co=$('ltCo').value; await carregar(L.co); preencherTopo();
    // cadastros mudam com a empresa: limpa o que era da empresa anterior
    L.rows.forEach(r=>{ r.cat=''; r.cc=''; if(r.contra){ r.contra=''; } }); draw();
    toast('Empresa trocada: categoria, centro de custo e '+contraLbl.toLowerCase()+' das linhas foram limpos.');
  };
  $('ltAplicar').onclick=()=>{
    const c=$('ltCatAll').value, cc=$('ltCCAll').value, ct=$('ltContraAll').value;
    if(!c && !cc && !ct){ toast('Escolha pelo menos um campo pra aplicar.','err'); return; }
    const def=c&&(L.cad.cat.find(x=>x.id===c)||{}).default_cost_center_id;
    L.rows.forEach(r=>{ if(c) r.cat=c; if(cc){ r.cc=cc; r.ccAuto=false; } else if(def&&(!r.cc||r.ccAuto)){ r.cc=def; r.ccAuto=true; } if(ct){ r.contra=ct; r.contraMiss=''; } }); draw();
  };
  $('ltAdd').onclick=()=>{ L.rows.push(novaLinha()); draw(); };
  $('ltAdd5').onclick=()=>{ for(let i=0;i<5;i++) L.rows.push(novaLinha()); draw(); };
  $('ltLimpar').onclick=()=>{ L.rows=L.rows.filter(r=>!loteLinhaVazia(r)); if(!L.rows.length) L.rows.push(novaLinha()); L.erroLinha=null; draw(); };
  $('ltColarBtn').onclick=()=>{ $('ltColarBox').style.display=''; $('ltColar').focus(); };
  $('ltColarCancel').onclick=()=>{ $('ltColarBox').style.display='none'; };
  $('ltColarOk').onclick=()=>{
    const novas=parseColagem($('ltColar').value);
    if(!novas.length){ toast('Nada reconhecido no texto colado.','err'); return; }
    if(novas.every(n=>n.semColunas)){ toast('Não reconheci as colunas. Copie direto do Excel, ou separe com ; ou | (Descrição ; Valor ; Vencimento).','err'); return; }
    const linhas=novas.map(n=>{ const c=n.contraNome?acharContra(L.cad.contra,n.contraNome):null;
      return {...novaLinha(), desc:n.desc, valor:n.valor, venc:n.venc, doc:n.doc, contra:c?c.id:'', contraMiss:(n.contraNome&&!c)?n.contraNome:''}; });
    L.rows=L.rows.filter(r=>!loteLinhaVazia(r)).concat(linhas);
    $('ltColar').value=''; $('ltColarBox').style.display='none'; L.mostrarErros=true; draw();
    const miss=linhas.filter(l=>l.contraMiss).length, inc=linhas.filter(l=>loteErros(l).length).length;
    toast(`${linhas.length} linha(s) adicionada(s).`+(inc?` ${inc} incompleta(s) (em vermelho).`:'')+(miss?` ${miss} sem ${contraLbl.toLowerCase()} encontrado.`:''), (inc||miss)?'err':'ok');
  };
  $('mSave').onclick=async ()=>{
    L.mostrarErros=true; L.erroLinha=null;
    const idx=L.rows.map((r,i)=>i).filter(i=>!loteLinhaVazia(L.rows[i]));
    if(!idx.length){ toast('Preencha pelo menos uma linha.','err'); return; }
    const ruins=idx.filter(i=>loteErros(L.rows[i]).length);
    if(ruins.length){ draw(); toast(`Linha(s) ${ruins.map(i=>i+1).join(', ')} incompleta(s): descrição, valor e vencimento são obrigatórios.`,'err'); return; }
    // duplicidade dentro do próprio lote
    const visto=new Map(), dupLote=[];
    idx.forEach(i=>{ const r=L.rows[i]; const k=`${r.contra}|${normTxt(r.desc).trim()}|${r.valor.toFixed(2)}|${r.venc}`; if(visto.has(k)) dupLote.push(i+1); else visto.set(k,i); });
    // duplicidade com o que já existe (mesma regra do formulário avulso)
    $('mSave').disabled=true; $('mSave').textContent='Conferindo…';
    const dupBanco=[];
    for(let k=0;k<idx.length;k+=10){
      const parte=idx.slice(k,k+10);
      const res=await Promise.all(parte.map(i=>{ const r=L.rows[i];
        return contaDuplicada(pagar?'payables':'receivables', L.co, r.contra||null, pagar?'supplier_id':'customer_id', r.desc.trim(), Number(r.valor.toFixed(2)), r.venc); }));
      res.forEach((d,j)=>{ if(d) dupBanco.push(parte[j]+1); });
    }
    $('mSave').disabled=false; resumo();
    if(dupLote.length||dupBanco.length){
      const txt=[dupLote.length?`Repetidas dentro do lote: linha(s) ${dupLote.join(', ')}.`:'', dupBanco.length?`Parecidas com contas que já existem: linha(s) ${dupBanco.join(', ')}.`:''].filter(Boolean).join(' ');
      const ok=await confirmOver({titulo:'Possíveis duplicadas',texto:txt+' Lançar assim mesmo?',ok:'Lançar assim mesmo'});
      if(!ok) return;
    }
    const acc=$('ltAcc').value||null, forma=$('ltForma').value||null, emis=$('ltEmis').value||null;
    const itens=idx.map(i=>{ const r=L.rows[i]; return { company_id:L.co, contraparte_id:r.contra||null, descricao:r.desc.trim(), valor:Number(r.valor.toFixed(2)),
      vencimento:r.venc, qtd_parcelas:r.parc, intervalo_meses:1, categoria_id:r.cat||null, cost_center_id:r.cc||null,
      financial_account_id:acc, documento:r.doc.trim()||null, forma, data_emissao:emis }; });
    $('mSave').disabled=true; $('mSave').textContent='Lançando…';
    const { data, error }=await db.rpc('criar_contas_lote',{ p_tipo:tipo, p_itens:itens });
    if(error){
      $('mSave').disabled=false; resumo();
      const m=String(error.message||'').match(/^Linha (\d+):/); if(m){ L.erroLinha=idx[+m[1]-1]; draw(); }
      toast('Nada foi lançado. '+(m?`Linha ${idx[+m[1]-1]+1}: `+error.message.replace(/^Linha \d+:\s*/,''):error.message),'err');
      return;
    }
    closeModal(); toast(`${data.criadas} conta(s) lançada(s) · ${money(data.total)}`);
    if(pagar) loadPagar(); else loadReceber();
  };
}
