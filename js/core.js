/* ===================== NÚCLEO — Supabase, helpers de formatação, toast, modais e utilitários compartilhados ===================== */
const configured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
let db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money = v => BRL.format(Number(v||0));
const $ = id => document.getElementById(id);
const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const todayStr = () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? d.split('-').reverse().join('/') : '—';
const daysLate = d => Math.floor((new Date(todayStr()) - new Date(d)) / 86400000);
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const STLABEL = {a_vencer:'A vencer',vencido:'Vencido',recebido:'Recebido',recebido_parcial:'Receb. parcial',cancelado:'Cancelado',aberto:'Em aberto',quitado:'Quitado'};

function toast(msg,type='ok'){
  const t=el('div','toast '+type,esc(msg)); $('toast').appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

let companies=[], companyId=null, currentView='dashboard';
let favSet=new Set(), userId=null;
const scopeQ = q => companyId ? q.eq('company_id',companyId) : q;
const PAGE_SIZE=40;

function pagerHTML(page,total,prefix){
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)), de=total?page*PAGE_SIZE+1:0, ate=Math.min(total,(page+1)*PAGE_SIZE);
  return `<div style="display:flex;align-items:center;gap:12px;justify-content:flex-end;margin-top:12px;font-size:13px;color:var(--muted)">
    <span>${de}–${ate} de ${total}</span>
    <button class="lnk" data-pg="${prefix}-prev" ${page<=0?'disabled style=opacity:.4':''}>‹ Anterior</button>
    <span>Página ${page+1} de ${pages}</span>
    <button class="lnk" data-pg="${prefix}-next" ${page+1>=pages?'disabled style=opacity:.4':''}>Próxima ›</button></div>`;
}

function closeModal(){ $('modalRoot').innerHTML=''; }

/* Confirmação que EMPILHA sobre outro modal (não apaga o formulário aberto) */
function confirmOver({titulo,texto,ok='Confirmar'}){
  return new Promise(res=>{
    const d=el('div','overlay'); d.style.zIndex='60';
    d.innerHTML=`<div class="modal sm"><div class="modal-h"><h2>${esc(titulo)}</h2><button class="x">×</button></div>
      <div class="modal-b"><p style="font-size:14px;line-height:1.5;color:var(--text)">${esc(texto)}</p></div>
      <div class="modal-f"><button class="btn ghost" data-no>Cancelar</button><button class="btn" data-yes>${esc(ok)}</button></div></div>`;
    document.body.appendChild(d);
    const done=v=>{ d.remove(); res(v); };
    d.querySelector('.x').onclick=d.querySelector('[data-no]').onclick=()=>done(false);
    d.querySelector('[data-yes]').onclick=()=>done(true);
  });
}
/* Checa se já existe conta parecida: mesma empresa, contraparte, valor, descrição e vencimento próximo */
async function contaDuplicada(tabela, co, contraId, contraCol, desc, val, primeiroVenc){
  const instTbl = tabela==='receivables'?'receivable_installments':'payable_installments';
  let q=db.from(tabela).select('id, '+instTbl+'(vencimento)').eq('company_id',co).eq('valor_total',val).neq('status','cancelado').ilike('descricao',desc);
  q = contraId ? q.eq(contraCol,contraId) : q.is(contraCol,null);
  const { data }=await q;
  if(!data||!data.length) return false;
  return data.some(r=>(r[instTbl]||[]).some(i=>Math.abs((new Date(primeiroVenc)-new Date(i.vencimento))/86400000)<=5));
}

/* Modal de confirmação com a identidade do Candidus (substitui o confirm() do navegador) */
function confirmModal({titulo, texto, ok='Confirmar', perigo=false}){
  return new Promise(resolve=>{
    $('modalRoot').innerHTML=`<div class="overlay"><div class="modal sm">
      <div class="modal-h"><h2>${esc(titulo)}</h2><button class="x" id="cfX">×</button></div>
      <div class="modal-b"><p style="font-size:14px;color:var(--text);line-height:1.5">${esc(texto)}</p></div>
      <div class="modal-f"><button class="btn ghost" id="cfNo">Cancelar</button>
        <button class="btn ${perigo?'danger':''}" id="cfYes">${esc(ok)}</button></div>
    </div></div>`;
    const done=v=>{ closeModal(); resolve(v); };
    $('cfX').onclick=$('cfNo').onclick=()=>done(false);
    $('cfYes').onclick=()=>done(true);
  });
}

const coName = id => { const c=companies.find(x=>x.id===id); return c?(c.nome_fantasia||c.razao_social):'—'; };
function statusPill(s){ return `<span class="pill st-${s==='ativo'?'quitado':'cancelado'}">${s==='ativo'?'Ativo':'Inativo'}</span>`; }
function cadFieldHTML(f,val){
  const v=val==null?(f.def!=null?f.def:''):val;
  const span=f.col===2?'style="grid-column:1/3"':'';
  if(f.type==='select') return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><select data-k="${f.k}">${f.opts.map(o=>`<option value="${o[0]}" ${String(v)===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></div>`;
  if(f.type==='textarea') return `<div class="field" ${span}><label>${f.l}</label><textarea data-k="${f.k}" rows="2">${esc(v)}</textarea></div>`;
  const t=f.type==='number'?'number':(f.type==='date'?'date':'text');
  return `<div class="field" ${span}><label>${f.l}${f.req?' *':''}</label><input data-k="${f.k}" type="${t}" ${f.type==='number'?'step="0.01"':''} value="${esc(v)}"></div>`;
}

const MES3=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const ymOf = d => (d||'').slice(0,7);
const ymLabel = ym => { const [y,m]=ym.split('-'); return MES3[+m-1]+'/'+y.slice(2); };
function ymAdd(ym,n){ let [y,m]=ym.split('-').map(Number); m=m-1+n; y+=Math.floor(m/12); m=((m%12)+12)%12; return `${y}-${String(m+1).padStart(2,'0')}`; }
function monthsRange(keys){ if(!keys.length) return []; const s=keys.slice().sort(); let cur=s[0]; const end=s[s.length-1], out=[]; let guard=0; while(cur<=end && guard++<240){ out.push(cur); cur=ymAdd(cur,1);} return out; }

const PRIO={baixa:'Baixa',media:'Média',alta:'Alta',critica:'Crítica'};
const PRIO_ORDER={critica:0,alta:1,media:2,baixa:3};

const MESNOME=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESCURTO=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const mesIni=(a,m)=>`${a}-${String(m).padStart(2,'0')}-01`;           // m = 1..12
const addMes=(a,m,n)=>{ const t=(a*12+(m-1))+n; return [Math.floor(t/12), (t%12)+1]; };
const num=v=>{ const n=parseFloat(String(v).replace(',','.')); return isNaN(n)?0:n; };
// "R$ 12,3 mil" / "R$ 1,2 mi"
function moneyCurto(v){ const a=Math.abs(v), s=v<0?'−':'';
  if(a>=1e6) return s+'R$ '+(a/1e6).toFixed(1).replace('.',',')+' mi';
  if(a>=1e3) return s+'R$ '+(a/1e3).toFixed(a>=1e4?0:1).replace('.',',')+' mil';
  return s+'R$ '+a.toFixed(0); }
const normDesc=s=>(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const rnd2=v=>Math.round(Number(v||0)*100)/100;

const normTxt=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');

const fmtPct=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
// CSV genérico pro Excel (; e vírgula decimal, BOM pros acentos)
function baixarCsv(arquivo, titulo, head, rows){
  const q=s=>`"${String(s).replace(/"/g,'""')}"`;
  const cel=v=>typeof v==='number'?(Math.round(v*100)/100).toFixed(2).replace('.',','):q(v);
  const out=[[q(titulo)],head.map(q),...rows.map(r=>r.map(cel))].map(r=>r.join(';')).join('\r\n');
  const blob=new Blob(['\ufeff'+out],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=arquivo; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}
