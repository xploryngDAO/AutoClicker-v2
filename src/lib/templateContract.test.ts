import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  generateBackgroundJs,
  generateContentJs,
  generateExtensionManifest,
  generatePopupHtml,
  generatePopupJs,
  generateSidepanelCss,
  generateSidepanelHtml,
  generateSidepanelJs,
} from './extensionTemplates.ts';
import { buildChromeExtensionZipEntries } from './codeGenerators.ts';
import { getDefaultConfig, getDefaultTasks } from './seedData.ts';

/**
 * Guarda de contrato dos templates.
 *
 * Estes testes existem porque a extensão já foi publicada com o content script
 * sintaticamente inválido (template literals sem crase), o que derrubava o HUD,
 * a gravação e o menu de ações sem nenhum aviso. Compilar cada arquivo gerado é
 * a barreira mínima: se ele não compila, a extensão não pode ser empacotada.
 */

const SCRIPT_FILES: Array<[string, () => string]> = [
  ['content.js', generateContentJs],
  ['background.js', () => generateBackgroundJs(getDefaultTasks(), getDefaultConfig())],
  ['sidepanel.js', generateSidepanelJs],
  ['popup.js', generatePopupJs],
];

for (const [name, factory] of SCRIPT_FILES) {
  test(`${name} gerado compila como JavaScript válido`, () => {
    const source = factory();
    assert.ok(source.length > 0, `${name} está vazio`);
    assert.doesNotThrow(() => {
      new vm.Script(source, { filename: name });
    }, `${name} tem erro de sintaxe`);
  });
}

test('nenhum template contém interpolação corrompida ({expr} sem cifrão)', () => {
  for (const [name, factory] of SCRIPT_FILES) {
    const source = factory();
    // Padrão que denuncia template literal quebrado: {identificador.propriedade}
    const broken = source.match(/\{[A-Za-z_$][\w$]*\.[\w$]/);
    assert.equal(broken, null, `${name} contém interpolação sem '$': ${broken && broken[0]}`);
  }
});

test('background.js tem as tarefas padrão injetadas e nenhum placeholder pendente', () => {
  const tasks = getDefaultTasks();
  const background = generateBackgroundJs(tasks, getDefaultConfig());

  assert.ok(!background.includes('__DEFAULT_TASKS_JSON__'), 'Placeholder de tarefas não substituído');
  assert.ok(!background.includes('__DEFAULT_CONFIG_JSON__'), 'Placeholder de configuração não substituído');
  assert.ok(background.includes(tasks[0].id), 'ID da primeira tarefa padrão ausente');
  assert.ok(background.includes('const DEFAULT_TASKS = [') || background.includes('const DEFAULT_TASKS = [{'), 'DEFAULT_TASKS não é um array');
});

test('manifest.json é JSON válido e aponta para os arquivos existentes no ZIP', () => {
  const manifest = JSON.parse(generateExtensionManifest());
  const entries = buildChromeExtensionZipEntries(getDefaultConfig(), []);
  const paths = new Set(entries.map((entry) => entry.path));

  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);

  assert.ok(paths.has(manifest.background.service_worker));
  assert.ok(paths.has(manifest.side_panel.default_path));
  assert.ok(paths.has(manifest.action.default_popup));
  assert.ok(paths.has(manifest.content_scripts[0].js[0]));

  for (const iconPath of Object.values(manifest.icons as Record<string, string>)) {
    assert.ok(paths.has(iconPath), `Ícone ausente no ZIP: ${iconPath}`);
  }
});

test('sidepanel referencia os arquivos e elementos que o script espera', () => {
  const html = generateSidepanelHtml();
  const js = generateSidepanelJs();

  for (const id of [
    'live-recording-banner',
    'select-active-task',
    'steps-list-container',
    'steps-empty-state',
    'log-list',
    'btn-start',
    'btn-pause',
    'btn-stop',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Elemento #${id} ausente no sidepanel.html`);
  }

  assert.ok(html.includes('sidepanel.js'), 'sidepanel.html não carrega sidepanel.js');
  assert.ok(html.includes('sidepanel.css'), 'sidepanel.html não carrega sidepanel.css');
  assert.ok(js.includes('GET_STATE'), 'sidepanel.js não consulta o estado no worker');
  assert.ok(js.includes('START_BATCH_EXECUTION'), 'sidepanel.js não inicia execução');
  assert.ok(js.includes('startStepIdx'), 'sidepanel.js não suporta executar a partir de um passo');
  assert.ok(js.includes('delay-2'), 'sidepanel.js não oferece o atalho +2s por passo');
});

test('popup e sidepanel não apontam para arquivos inexistentes', () => {
  const popup = generatePopupHtml();
  assert.ok(popup.includes('popup.js'));
  assert.ok(!popup.includes('content.js'), 'popup.html não deve carregar o content script');

  const css = generateSidepanelCss();
  assert.ok(css.includes('.steps-timeline'), 'CSS sem estilos da lista de passos');
  assert.ok(css.includes('.step-actions'), 'CSS sem estilos do menu de ações');
});

test('content.js declara toda a API de mensagens usada pelo worker e pelo painel', () => {
  const content = generateContentJs();

  for (const type of [
    'RPA_EXECUTE_TASK',
    'RPA_ABORT',
    'RPA_PAUSE',
    'RPA_RESUME',
    'RPA_START_RECORDING',
    'RPA_RESUME_RECORDING',
    'RPA_PING',
    'SAVE_RECORDED_STEPS',
    'SYNC_RECORDING_STEP',
    'CANCEL_RECORDING_SESSION',
    'UPDATE_STATS',
  ]) {
    assert.ok(content.includes(type), `content.js não trata a mensagem ${type}`);
  }
});

test('content.js não usa sendMessage sem callback (evita unhandled rejection)', () => {
  const content = generateContentJs();
  // Chamadas diretas com .catch() são frágeis: chrome.runtime.sendMessage pode
  // devolver undefined em versões antigas. O contrato é usar o helper safeMessage.
  assert.ok(content.includes('function safeMessage'), 'Missing safeMessage helper');
  assert.ok(!/chrome\.runtime\.sendMessage\([^)]*\)\s*\.catch/.test(content), 'sendMessage não deve ser encadeado com .catch()');
});
