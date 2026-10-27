/**
 * Gera src/lib/generated/templateStrings.ts a partir dos arquivos reais em
 * src/lib/templates/.
 *
 * Motivo: os templates da extensão (content script, side panel, popup,
 * service worker) são distribuídos como texto puro dentro de um ZIP. Mantê-los
 * como arquivos .js/.html/.css normais permite lint, syntax highlighting e —
 * principalmente — validação de sintaxe em tempo de geração, que é o que
 * impedia a extensão de quebrar silenciosamente em produção.
 *
 * Uso: node scripts/build-templates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const templatesDir = path.join(root, 'src', 'lib', 'templates');
const outputDir = path.join(root, 'src', 'lib', 'generated');
const outputFile = path.join(outputDir, 'templateStrings.ts');

/** @type {Array<{exportName: string, fileName: string, kind: 'script'|'text'}>} */
const TEMPLATES = [
  { exportName: 'CONTENT_JS', fileName: 'content.js', kind: 'script' },
  { exportName: 'BACKGROUND_JS', fileName: 'background.js', kind: 'script' },
  { exportName: 'SIDEPANEL_HTML', fileName: 'sidepanel.html', kind: 'text' },
  { exportName: 'SIDEPANEL_CSS', fileName: 'sidepanel.css', kind: 'text' },
  { exportName: 'SIDEPANEL_JS', fileName: 'sidepanel.js', kind: 'script' },
  { exportName: 'POPUP_HTML', fileName: 'popup.html', kind: 'text' },
  { exportName: 'POPUP_JS', fileName: 'popup.js', kind: 'script' },
];

function fail(message) {
  console.error(`\n[build-templates] ERRO: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(templatesDir)) {
  fail(`diretório de templates não encontrado: ${templatesDir}`);
}

const chunks = [];
const summary = [];

for (const template of TEMPLATES) {
  const fullPath = path.join(templatesDir, template.fileName);
  if (!fs.existsSync(fullPath)) {
    fail(`template ausente: ${template.fileName}`);
  }

  const source = fs.readFileSync(fullPath, 'utf8');

  if (template.kind === 'script') {
    try {
      // Compila sem executar: pega qualquer erro de sintaxe antes de empacotar
      // a extensão, que é exatamente o tipo de falha que passava despercebida.
      new vm.Script(source, { filename: template.fileName });
    } catch (err) {
      fail(
        `${template.fileName} tem erro de sintaxe e geraria uma extensão quebrada:\n` +
          `${err && err.stack ? err.stack : err}`
      );
    }
  }

  if (!source.trim()) {
    fail(`${template.fileName} está vazio.`);
  }

  chunks.push(
    `/** Conteúdo de src/lib/templates/${template.fileName} */\n` +
      `export const ${template.exportName} = ${JSON.stringify(source)};\n`
  );
  summary.push(`${template.fileName.padEnd(18)} ${String(source.length).padStart(7)} bytes`);
}

const header =
  '// ---------------------------------------------------------------------------\n' +
  '// ARQUIVO GERADO AUTOMATICAMENTE por scripts/build-templates.mjs.\n' +
  '// Não edite aqui: altere os arquivos em src/lib/templates/ e rode `npm run gen`.\n' +
  '// ---------------------------------------------------------------------------\n\n';

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, header + chunks.join('\n'), 'utf8');

console.log('[build-templates] templates validados e gerados:');
for (const line of summary) console.log('  ' + line);
console.log(`  -> ${path.relative(root, outputFile)}`);
