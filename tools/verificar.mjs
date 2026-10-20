// Verificação antes de publicar: rode `node tools/verificar.mjs` na raiz do projeto.
// 1) node --check em cada JS carregado pelo index.html (erro de sintaxe)
// 2) nomes globais duplicados entre arquivos: redeclarar `function x` não dá erro no
//    navegador, a última vence e quebra a outra em silêncio; `const/let` repetido
//    derruba o arquivo inteiro.
// 3) arquivo .js em js/ que o index.html esquece de carregar.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
let falhas = 0;

for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { falhas++; console.log(`✗ sintaxe: ${f}\n${e.stderr}`); }
}

// declarações do topo começam na coluna 0 (padrão do projeto)
const onde = {};
for (const f of scripts) {
  for (const linha of readFileSync(f, 'utf8').split('\n')) {
    const m = linha.match(/^(?:async\s+)?function\s+([\w$]+)/);
    const nomes = m ? [m[1]] : [];
    if (/^(?:const|let|var)\s/.test(linha)) {
      // "let a=1, b=[]; let c=null" → a, b, c (ignora , e ; dentro de () [] {})
      let prof = 0, atual = '';
      const pedacos = [];
      for (const ch of linha) {
        if ('([{'.includes(ch)) prof++; else if (')]}'.includes(ch)) prof--;
        if ((ch === ',' || ch === ';') && prof === 0) { pedacos.push(atual); atual = ''; } else atual += ch;
      }
      pedacos.push(atual);
      for (const p of pedacos) {
        const n = p.trim().replace(/^(?:const|let|var)\s+/, '').match(/^([\w$]+)\s*(=|$)/);
        if (n) nomes.push(n[1]);
      }
    }
    for (const n of nomes) {
      if (onde[n]) { falhas++; console.log(`✗ nome global duplicado: ${n} (${onde[n]} e ${f})`); }
      else onde[n] = f;
    }
  }
}

const todos = [];
(function varrer(d) { for (const x of readdirSync(d)) { const p = join(d, x).replace(/\\/g, '/'); statSync(p).isDirectory() ? varrer(p) : p.endsWith('.js') && todos.push(p); } })('js');
for (const f of todos) if (!scripts.includes(f)) { falhas++; console.log(`✗ não carregado no index.html: ${f}`); }

if (scripts.at(-1) !== 'js/app.js') { falhas++; console.log('✗ js/app.js precisa ser o último <script> (ele chama boot())'); }

console.log(falhas ? `\n${falhas} problema(s).` : `✓ ${scripts.length} arquivos ok · ${Object.keys(onde).length} nomes globais, nenhum duplicado`);
process.exit(falhas ? 1 : 0);
