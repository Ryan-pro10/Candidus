/* ===================== undefined ===================== */
function regraBate(r, bt){
  if(!r.ativo || r.company_id!==bt.company_id) return false;
  if(r.tipo_movimento!=='ambos' && r.tipo_movimento!==bt.tipo) return false;
  if(r.valor_min!=null && bt.valor<Number(r.valor_min)) return false;
  if(r.valor_max!=null && bt.valor>Number(r.valor_max)) return false;
  return normTxt(bt.descricao).includes(normTxt(r.texto).trim());
}
// sugere o "contém" a partir da descrição do extrato: 2 primeiras palavras sem números
function sugerirTextoRegra(desc){
  const w=(desc||'').split(/\s+/).filter(x=>x.length>=3 && !/\d/.test(x));
  return w.slice(0,2).join(' ') || (desc||'').trim().slice(0,20);
}
async function aplicarRegras(ids){
  if(!ids){
    const n=concState.regras.size;
    const ok=await confirmModal({titulo:'Aplicar regras',texto:`Aplicar as regras em ${n} movimento(s) pendente(s)? Regras de lançamento criam a conta já conciliada; regras de transferência marcam o movimento como transferência.`,ok:'Aplicar'});
    if(!ok) return;
  }
  const { data, error }=await db.rpc('aplicar_regras_conciliacao',{ p_company:companyId||null, p_bank_transaction_ids:ids||null, p_somente_auto:false });
  if(error){ toast('Erro: '+error.message,'err'); return; }
  const r=data||{};
  if(r.erros) toast(`${r.aplicados||0} aplicado(s), ${r.erros} com erro: ${(r.mensagens||[])[0]||''}`,'err');
  else toast((r.aplicados||0)+' movimento(s) resolvido(s) por regra!');
  loadConciliacao();
}
let regrasCache=[];
async function loadRegras(){
  try{
    const { data, error }=await scopeQ(db.from('conciliation_rules').select('*, categories(nome), cost_centers(nome), suppliers(razao_social,nome_fantasia), customers(razao_social,nome_fantasia)')).order('prioridade').order('nome');
    if(error) throw error;
    regrasCache=data||[]; drawRegras();
  }catch(err){ $('cncArea').innerHTML=`<div class="panel"><div class="empty">Erro: ${esc(err.message||err)}<br>Rodou o candidus_regras_conciliacao.sql?</div></div>`; }
}
function drawRegras(){
  const coNome=id=>{ const c=companies.find(x=>x.id===id); return c?(c.nome_fantasia||c.razao_social):''; };
  const tipoLbl={entrada:'Entrada',saida:'Saída',ambos:'Entrada e saída'};
  const rows=regrasCache.map((r,i)=>{
    const faixa=(r.valor_min!=null||r.valor_max!=null)?`<div style="font-size:12px;color:var(--muted)">${r.valor_min!=null?'de '+money(r.valor_min):''} ${r.valor_max!=null?'até '+money(r.valor_max):''}</div>`:'';
    const contra=(r.suppliers&&(r.suppliers.nome_fantasia||r.suppliers.razao_social))||(r.customers&&(r.customers.nome_fantasia||r.customers.razao_social));
    const acao=r.acao==='transferencia'?'Marca como <b>transferência</b>':`Lança em <b>${esc(r.categories&&r.categories.nome||'—')}</b>${contra?' · '+esc(contra):''}${r.cost_centers?' · CC '+esc(r.cost_centers.nome):''}`;
    return `<tr style="${r.ativo?'':'opacity:.5'}">
      <td><b>${esc(r.nome)}</b>${companyId?'':`<div style="font-size:12px;color:var(--muted)">${esc(coNome(r.company_id))}</div>`}</td>
      <td>contém “${esc(r.texto)}”${faixa}</td><td>${tipoLbl[r.tipo_movimento]}</td><td style="font-size:13px">${acao}</td>
      <td>${r.aplicar_auto?'<span class="pill st-recebido">Auto</span>':'<span class="pill st-recebido_parcial">Manual</span>'}</td>
      <td class="r">${r.qtd_aplicada||0}</td>
      <td><div class="act"><button class="lnk" data-redit="${i}">Editar</button><button class="lnk" data-rtog="${i}">${r.ativo?'Desativar':'Ativar'}</button><button class="lnk del" data-rdel="${i}">Excluir</button></div></td></tr>`;
  }).join('');
  $('cncArea').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px">
      <span style="font-size:13px;color:var(--muted)">Regras resolvem sozinhas os movimentos repetitivos (tarifas, IOF, rendimentos, transferências entre contas). A primeira regra que bater (menor prioridade) é a usada.</span>
      <button class="btn" id="rgNova">+ Nova regra</button></div>
    <div class="panel">${regrasCache.length?`<table><thead><tr><th>Regra</th><th>Descrição</th><th>Tipo</th><th>Ação</th><th>Quando</th><th class="r">Usos</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">Nenhuma regra ainda. Crie uma aqui ou marque “criar regra” ao usar Criar lançamento na conciliação.</div>'}</div>`;
  $('rgNova').onclick=()=>openRegra(null);
  $('cncArea').querySelectorAll('[data-redit]').forEach(b=>b.onclick=()=>openRegra(regrasCache[+b.dataset.redit]));
  $('cncArea').querySelectorAll('[data-rtog]').forEach(b=>b.onclick=async ()=>{ const r=regrasCache[+b.dataset.rtog];
    const { error }=await db.from('conciliation_rules').update({ativo:!r.ativo}).eq('id',r.id); if(error){toast('Erro: '+error.message,'err');return;} loadRegras(); });
  $('cncArea').querySelectorAll('[data-rdel]').forEach(b=>b.onclick=async ()=>{ const r=regrasCache[+b.dataset.rdel];
    const ok=await confirmModal({titulo:'Excluir regra',texto:`Excluir a regra “${r.nome}”? O que ela já lançou continua no sistema.`,ok:'Excluir',perigo:true}); if(!ok) return;
    const { error }=await db.from('conciliation_rules').delete().eq('id',r.id); if(error){toast('Erro: '+error.message,'err');return;} toast('Regra excluída.'); loadRegras(); });
}
async function openRegra(rec){
  const r=rec||{ company_id:companyId||(companies[0]&&companies[0].id)||'', nome:'', texto:'', tipo_movimento:'saida', acao:'lancar', aplicar_auto:true, ativo:true, prioridade:100 };
  const opt=(arr,lbl,sel)=>'<option value="">—</option>'+(arr||[]).map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(lbl(x))}</option>`).join('');
  $('modalRoot').innerHTML=`<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${rec?'Editar regra':'Nova regra'}</h2><button class="x" id="mx">×</button></div>
    <div class="modal-b"><div class="cadgrid">
      <div class="field" style="grid-column:1/3"><label>Empresa</label><select id="rgCo" ${rec||companyId?'disabled':''}>${companies.map(c=>`<option value="${c.id}" ${c.id===r.company_id?'selected':''}>${esc(c.nome_fantasia||c.razao_social)}</option>`).join('')}</select></div>
      <div class="field"><label>Nome da regra *</label><input id="rgNome" value="${esc(r.nome)}" placeholder="Ex.: Tarifa bancária"></div>
      <div class="field"><label>Descrição do extrato contém *</label><input id="rgTexto" value="${esc(r.texto)}" placeholder="Ex.: TARIFA"></div>
      <div class="field"><label>Ação</label><select id="rgAcao"><option value="lancar" ${r.acao==='lancar'?'selected':''}>Lançar conta e conciliar</option><option value="transferencia" ${r.acao==='transferencia'?'selected':''}>Marcar como transferência</option></select></div>
      <div class="field"><label>Tipo de movimento</label><select id="rgTipo"></select></div>
      <div class="field"><label>Valor mínimo</label><input id="rgMin" type="number" step="0.01" value="${r.valor_min!=null?r.valor_min:''}" placeholder="opcional"></div>
      <div class="field"><label>Valor máximo</label><input id="rgMax" type="number" step="0.01" value="${r.valor_max!=null?r.valor_max:''}" placeholder="opcional"></div>
      <div class="field rgL"><label>Categoria *</label><select id="rgCat"></select></div>
      <div class="field rgL"><label id="rgContraL">Fornecedor</label><select id="rgContra"></select></div>
      <div class="field rgL"><label>Centro de custo</label><select id="rgCC"></select></div>
      <div class="field rgL"><label>Descrição do lançamento</label><input id="rgDesc" value="${esc(r.descricao_lancamento||'')}" placeholder="vazio = descrição do extrato"></div>
      <div class="field"><label>Prioridade</label><input id="rgPrio" type="number" step="1" value="${r.prioridade}"></div>
      <div class="field" style="display:flex;flex-direction:column;gap:6px;justify-content:flex-end">
        <label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="rgAuto" ${r.aplicar_auto?'checked':''} style="width:16px;height:16px"> Aplicar sozinha ao importar extrato</label>
        <label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" id="rgAtivo" ${r.ativo?'checked':''} style="width:16px;height:16px"> Ativa</label></div>
    </div>
    <div id="rgPrev" class="box" style="margin:12px 0 0"></div></div>
    <div class="modal-f"><button class="btn ghost" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div></div></div>`;
  $('mx').onclick=$('mCancel').onclick=closeModal;
  let cad={co:null}, pend=[];
  const carregarCo=async co=>{
    if(cad.co===co) return;
    const [cat,cc,forn,cli,bts]=await Promise.all([
      db.from('categories').select('id,nome,tipo').eq('company_id',co).order('nome'),
      db.from('cost_centers').select('id,nome').eq('company_id',co).order('nome'),
      db.from('suppliers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
      db.from('customers').select('id,razao_social,nome_fantasia').eq('company_id',co).order('razao_social'),
      db.from('bank_transactions').select('id,data,descricao,valor,tipo,company_id').eq('company_id',co).eq('conciliado',false).in('tipo',['entrada','saida']).order('data',{ascending:false}).limit(1000),
    ]);
    cad={co,cat:cat.data||[],cc:cc.data||[],forn:forn.data||[],cli:cli.data||[]};
    pend=(bts.data||[]).map(b=>({...b,valor:Number(b.valor)}));
  };
  const refresh=()=>{
    const acao=$('rgAcao').value; const tipoAtual=$('rgTipo').value||r.tipo_movimento;
    const tipos=acao==='transferencia'?[['ambos','Entrada e saída'],['saida','Saída'],['entrada','Entrada']]:[['saida','Saída'],['entrada','Entrada']];
    const tSel=tipos.some(t=>t[0]===tipoAtual)?tipoAtual:tipos[0][0];
    $('rgTipo').innerHTML=tipos.map(t=>`<option value="${t[0]}" ${t[0]===tSel?'selected':''}>${t[1]}</option>`).join('');
    document.querySelectorAll('.rgL').forEach(el=>el.style.display=acao==='lancar'?'':'none');
    if(acao==='lancar'){
      const catSel=$('rgCat').value||r.categoria_id, ccSel=$('rgCC').value||r.cost_center_id;
      $('rgCat').innerHTML=opt(cad.cat.filter(c=>c.tipo===(tSel==='entrada'?'receita':'despesa')),x=>x.nome,catSel);
      $('rgCC').innerHTML=opt(cad.cc,x=>x.nome,ccSel);
      $('rgContraL').textContent=tSel==='entrada'?'Cliente':'Fornecedor';
      const lista=tSel==='entrada'?cad.cli:cad.forn; const contraSel=$('rgContra').value||(tSel==='entrada'?r.customer_id:r.supplier_id);
      $('rgContra').innerHTML=opt(lista,x=>x.nome_fantasia||x.razao_social,contraSel);
    }
    preview();
  };
  const preview=()=>{
    const fake={ativo:true,company_id:cad.co,tipo_movimento:$('rgTipo').value,texto:$('rgTexto').value,
      valor_min:$('rgMin').value===''?null:Number($('rgMin').value), valor_max:$('rgMax').value===''?null:Number($('rgMax').value)};
    if(normTxt(fake.texto).trim().length<2){ $('rgPrev').innerHTML='<span style="color:var(--muted)">Digite o texto pra ver quais movimentos pendentes a regra pegaria.</span>'; return; }
    const hits=pend.filter(b=>regraBate(fake,b));
    $('rgPrev').innerHTML=hits.length?`Pegaria <b>${hits.length}</b> movimento(s) pendente(s) agora:<br>`+hits.slice(0,5).map(b=>`${fmtDate(b.data)} · ${esc(b.descricao)} · ${money(b.valor)}`).join('<br>')+(hits.length>5?'<br>…':'')
      :'<span style="color:var(--muted)">Nenhum movimento pendente bate com essa regra agora.</span>';
  };
  await carregarCo($('rgCo').value); refresh();
  $('rgCo').onchange=async ()=>{ await carregarCo($('rgCo').value); refresh(); };
  $('rgAcao').onchange=refresh; $('rgTipo').onchange=refresh;
  ['rgTexto','rgMin','rgMax'].forEach(id=>$(id).oninput=preview);
  $('mSave').onclick=async ()=>{
    const acao=$('rgAcao').value, tipo=$('rgTipo').value;
    const p={ company_id:$('rgCo').value, nome:$('rgNome').value.trim(), texto:$('rgTexto').value.trim(), tipo_movimento:tipo, acao,
      valor_min:$('rgMin').value===''?null:Number($('rgMin').value), valor_max:$('rgMax').value===''?null:Number($('rgMax').value),
      categoria_id:acao==='lancar'?($('rgCat').value||null):null, cost_center_id:acao==='lancar'?($('rgCC').value||null):null,
      supplier_id:acao==='lancar'&&tipo==='saida'?($('rgContra').value||null):null, customer_id:acao==='lancar'&&tipo==='entrada'?($('rgContra').value||null):null,
      descricao_lancamento:acao==='lancar'?($('rgDesc').value.trim()||null):null,
      prioridade:parseInt($('rgPrio').value,10)||100, aplicar_auto:$('rgAuto').checked, ativo:$('rgAtivo').checked };
    if(!p.nome){ toast('Dê um nome à regra.','err'); return; }
    if(p.texto.length<2){ toast('O texto precisa ter pelo menos 2 caracteres.','err'); return; }
    if(acao==='lancar' && !p.categoria_id){ toast('Escolha a categoria do lançamento.','err'); return; }
    if(p.valor_min!=null && p.valor_max!=null && p.valor_min>p.valor_max){ toast('Valor mínimo maior que o máximo.','err'); return; }
    $('mSave').disabled=true;
    const q=rec?db.from('conciliation_rules').update(p).eq('id',rec.id):db.from('conciliation_rules').insert(p);
    const { error }=await q;
    if(error){ $('mSave').disabled=false; toast('Erro: '+error.message,'err'); return; }
    closeModal(); toast(rec?'Regra atualizada.':'Regra criada.'); loadRegras();
  };
}
