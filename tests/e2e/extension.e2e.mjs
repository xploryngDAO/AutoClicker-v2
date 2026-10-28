/**
 * Testes de ponta a ponta do content script da extensão em um Chrome real.
 *
 * Cada cenário sobe uma página HTTP própria (realm novo a cada navegação) com
 * o padrão de widget correspondente: combobox ARIA, Radix, MUI, accordion,
 * modal, select nativo, checkbox, campo de texto e elemento com atraso.
 *
 * O content script é injetado com a API `chrome` simulada, exatamente como o
 * Chrome faria — e a execução é comparada com o efeito real no DOM.
 *
 * Uso: node tests/e2e/extension.e2e.mjs [caminho-do-chrome]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import { generateContentJs } from '../../src/lib/extensionTemplates.ts';

const CHROME_CANDIDATES = [
  process.argv[2],
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  console.error('Nenhum Chrome/Edge encontrado. Passe o caminho como argumento.');
  process.exit(2);
}

const contentJs = generateContentJs();

const STUB = `
(function () {
  window.__aa = { listeners: [], storage: {}, logs: [] };
  window.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) out[key] = window.__aa.storage[key];
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set(payload, cb) {
          Object.assign(window.__aa.storage, payload);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    },
    runtime: {
      sendMessage(msg, cb) {
        window.__aa.logs.push(msg);
        if (cb) cb({ ok: true });
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener(fn) { window.__aa.listeners.push(fn); } },
      lastError: undefined
    }
  };
  window.__aaSend = function (msg) {
    for (const listener of window.__aa.listeners) listener(msg, {}, function () {});
  };
})();
`;

// ------------------------------------------------------------
// Páginas de teste
// ------------------------------------------------------------
const FIXTURES = {
  '/long': `
    <div id="log"></div>
    <script>
      window.__clicks = [];
      for (let i = 1; i <= 12; i += 1) {
        const button = document.createElement('button');
        button.id = 'b' + i;
        button.type = 'button';
        button.textContent = 'Botão ' + i;
        button.style.margin = '4px';
        button.addEventListener('click', (event) => window.__clicks.push(event.currentTarget.id));
        document.body.appendChild(button);
      }
    </script>`,

  '/aria': `
    <button id="aria" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-controls="aria-menu">Plano</button>
    <div id="aria-menu" role="listbox" hidden>
      <div role="option" data-value="30">30 dias</div>
      <div role="option" data-value="90">90 dias</div>
    </div>
    <script>
      window.__ariaOpens = 0;
      const trigger = document.getElementById('aria');
      const menu = document.getElementById('aria-menu');
      trigger.addEventListener('click', () => {
        window.__ariaOpens += 1;
        const open = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', String(!open));
        menu.hidden = open;
      });
      menu.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        trigger.textContent = option.textContent;
        trigger.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
      });
    </script>`,

  '/radix': `
    <button id="radix" role="combobox" aria-expanded="false">Escolher</button>
    <div id="radix-menu" role="listbox" style="display:none">
      <div role="option">Opção A</div>
      <div role="option">Opção B</div>
    </div>
    <script>
      window.__radixOpens = 0;
      const trigger = document.getElementById('radix');
      const menu = document.getElementById('radix-menu');
      trigger.addEventListener('pointerdown', () => {
        window.__radixOpens += 1;
        const open = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', String(!open));
        menu.style.display = open ? 'none' : 'block';
      });
      menu.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        trigger.textContent = option.textContent;
        trigger.setAttribute('aria-expanded', 'false');
        menu.style.display = 'none';
      });
    </script>`,

  '/mui': `
    <div id="mui" role="combobox" aria-expanded="false" tabindex="0" style="padding:6px;border:1px solid #999;width:180px">Perfil</div>
    <ul id="mui-menu" role="listbox" style="display:none">
      <li role="option">Admin</li>
      <li role="option">Leitor</li>
    </ul>
    <script>
      window.__muiOpens = 0;
      const trigger = document.getElementById('mui');
      const menu = document.getElementById('mui-menu');
      trigger.addEventListener('mousedown', () => {
        window.__muiOpens += 1;
        trigger.setAttribute('aria-expanded', 'true');
        menu.style.display = 'block';
      });
      menu.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        trigger.textContent = option.textContent;
        trigger.setAttribute('aria-expanded', 'false');
        menu.style.display = 'none';
      });
      document.addEventListener('click', (event) => {
        if (!trigger.contains(event.target) && !menu.contains(event.target)) {
          trigger.setAttribute('aria-expanded', 'false');
          menu.style.display = 'none';
        }
      });
    </script>`,

  '/accordion': `
    <button id="acc" aria-expanded="false">Detalhes</button>
    <div id="acc-panel" hidden>Conteúdo do painel</div>
    <script>
      window.__accToggles = 0;
      const button = document.getElementById('acc');
      const panel = document.getElementById('acc-panel');
      button.addEventListener('click', () => {
        window.__accToggles += 1;
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
      });
    </script>`,

  '/form': `
    <input id="name" type="text" />
    <select id="days">
      <option value="30">30 dias</option>
      <option value="90">90 dias</option>
    </select>
    <label for="agree">Concordo</label>
    <input id="agree" type="checkbox" />
    <script>
      window.__events = [];
      document.getElementById('name').addEventListener('input', (e) => window.__events.push('input:' + e.target.value));
      document.getElementById('days').addEventListener('change', (e) => window.__events.push('select:' + e.target.value));
      document.getElementById('agree').addEventListener('change', (e) => window.__events.push('check:' + e.target.checked));
    </script>`,

  '/modal': `
    <button id="open-modal">Abrir</button>
    <div id="modal" hidden>
      <button id="confirm">Confirmar</button>
      <button id="close-modal">Fechar</button>
    </div>
    <div id="status">fechado</div>
    <script>
      const modal = document.getElementById('modal');
      document.getElementById('open-modal').addEventListener('click', () => {
        modal.hidden = false;
        document.getElementById('status').textContent = 'aberto';
      });
      document.getElementById('confirm').addEventListener('click', () => {
        document.getElementById('status').textContent = 'confirmado';
      });
      document.getElementById('close-modal').addEventListener('click', () => {
        modal.hidden = true;
      });
    </script>`,

  '/late': `
    <div id="holder"></div>
    <div id="done">0</div>
    <script>
      window.__lateClicks = 0;
      setTimeout(() => {
        const button = document.createElement('button');
        button.id = 'late';
        button.textContent = 'Apareceu';
        button.addEventListener('click', () => {
          window.__lateClicks += 1;
          document.getElementById('done').textContent = String(window.__lateClicks);
        });
        document.getElementById('holder').appendChild(button);
      }, 900);
    </script>`,

  '/label': `
    <label for="dup">Marcar opção</label>
    <input id="dup" type="checkbox" />`,
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const body = FIXTURES[pathname];
  if (!body) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript({ content: STUB });

async function openFixture(pathname) {
  const page = await context.newPage();
  await page.goto(baseUrl + pathname, { waitUntil: 'load' });
  await page.addScriptTag({ content: contentJs });
  await page.waitForTimeout(120);
  return page;
}

async function reopen(page, pathname) {
  await page.goto(baseUrl + pathname, { waitUntil: 'load' });
  await page.addScriptTag({ content: contentJs });
  await page.waitForTimeout(120);
}

async function startRecording(page, taskId = 'task-e2e') {
  await page.evaluate((id) => window.__aaSend({ type: 'RPA_START_RECORDING', mode: 'free', taskId: id }), taskId);
  await page.waitForTimeout(60);
}

async function finishRecording(page) {
  await page.click('[data-hud-act="finish"]');
  await page.waitForTimeout(250);

  const steps = await page.evaluate(() => {
    const saves = window.__aa.logs.filter((m) => m.type === 'SAVE_RECORDED_STEPS');
    return saves.length ? saves[saves.length - 1].steps : [];
  });

  return steps.map((step) => ({ ...step, waitBeforeMs: 0 }));
}

async function execute(page, steps, name) {
  await page.evaluate(
    ({ flow, flowName }) => {
      window.__aaSend({
        type: 'RPA_EXECUTE_TASK',
        config: { baseDelayMs: 0, randomJitterMs: 0 },
        task: {
          id: 'task-e2e',
          name: flowName,
          pattern: 'free_macro',
          repeatMode: 'once',
          steps: flow,
        },
      });
    },
    { flow: steps, flowName: name }
  );
}

async function waitDone(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => {
      const stats = window.__aa.logs.filter((m) => m.type === 'UPDATE_STATS' && m.patch && m.patch.status);
      return Boolean(stats.length && stats[stats.length - 1].patch.status === 'idle');
    });
    if (done) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function engineLogs(page) {
  return page.evaluate(() =>
    window.__aa.logs.filter((m) => m.logEntry).map((m) => m.logEntry.level + ': ' + m.logEntry.message)
  );
}

// ============================================================
// 1. Fluxo longo
// ============================================================
{
  const page = await openFixture('/long');
  await startRecording(page);
  for (let i = 1; i <= 12; i += 1) {
    await page.click(`#b${i}`);
    await page.waitForTimeout(50);
  }
  const steps = await finishRecording(page);
  check('fluxo longo: 12 cliques gravados', steps.length === 12, `gravados=${steps.length}`);

  await reopen(page, '/long');
  await execute(page, steps, 'Fluxo longo');
  await waitDone(page, 90000);

  const clicks = await page.evaluate(() => window.__clicks);
  const expected = Array.from({ length: 12 }, (_, i) => `b${i + 1}`);
  check(
    'fluxo longo: 12 passos executados na ordem',
    JSON.stringify(clicks) === JSON.stringify(expected),
    JSON.stringify(clicks)
  );
  await page.close();
}

// ============================================================
// 2. Dropdown ARIA
// ============================================================
{
  const page = await openFixture('/aria');
  await startRecording(page);
  await page.click('#aria');
  await page.waitForTimeout(120);
  await page.click('#aria-menu [role="option"]:has-text("90 dias")');
  await page.waitForTimeout(120);
  const steps = await finishRecording(page);
  check('dropdown ARIA: gatilho + opção gravados', steps.length === 2, `passos=${steps.length}`);

  await reopen(page, '/aria');
  await execute(page, steps, 'ARIA');
  await waitDone(page);

  const state = await page.evaluate(() => ({
    text: document.getElementById('aria').textContent.trim(),
    expanded: document.getElementById('aria').getAttribute('aria-expanded'),
    hidden: document.getElementById('aria-menu').hidden,
    opens: window.__ariaOpens,
  }));

  check('dropdown ARIA: opção aplicada', state.text === '90 dias', state.text);
  check('dropdown ARIA: aberto uma única vez', state.opens === 1, `aberturas=${state.opens}`);
  check('dropdown ARIA: fechado no fim', state.hidden === true && state.expanded === 'false');
  if (state.text !== '90 dias') console.log((await engineLogs(page)).join('\n'));
  await page.close();
}

// ============================================================
// 3. Dropdown Radix (abre no pointerdown)
// ============================================================
{
  const page = await openFixture('/radix');
  await startRecording(page);
  await page.click('#radix');
  await page.waitForTimeout(150);
  await page.click('#radix-menu [role="option"]:has-text("Opção B")');
  await page.waitForTimeout(120);
  const steps = await finishRecording(page);

  await reopen(page, '/radix');
  await execute(page, steps, 'Radix');
  await waitDone(page);

  const state = await page.evaluate(() => ({
    text: document.getElementById('radix').textContent.trim(),
    opens: window.__radixOpens,
    hidden: document.getElementById('radix-menu').style.display === 'none',
  }));

  check('dropdown Radix: opção aplicada', state.text === 'Opção B', state.text);
  check('dropdown Radix: aberto uma única vez', state.opens === 1, `aberturas=${state.opens}`);
  check('dropdown Radix: fechado no fim', state.hidden === true);
  if (state.text !== 'Opção B') console.log((await engineLogs(page)).join('\n'));
  await page.close();
}

// ============================================================
// 4. Dropdown MUI (abre no mousedown)
// ============================================================
{
  const page = await openFixture('/mui');
  await startRecording(page);
  await page.click('#mui');
  await page.waitForTimeout(150);
  await page.click('#mui-menu [role="option"]:has-text("Leitor")');
  await page.waitForTimeout(120);
  const steps = await finishRecording(page);

  await reopen(page, '/mui');
  await execute(page, steps, 'MUI');
  await waitDone(page);

  const state = await page.evaluate(() => ({
    text: document.getElementById('mui').textContent.trim(),
    opens: window.__muiOpens,
    expanded: document.getElementById('mui').getAttribute('aria-expanded'),
  }));

  check('dropdown MUI: opção aplicada', state.text === 'Leitor', state.text);
  check('dropdown MUI: aberto uma única vez', state.opens === 1, `aberturas=${state.opens}`);
  check('dropdown MUI: fechado no fim', state.expanded === 'false');
  if (state.text !== 'Leitor') console.log((await engineLogs(page)).join('\n'));
  await page.close();
}

// ============================================================
// 5. Accordion
// ============================================================
{
  const page = await openFixture('/accordion');
  await startRecording(page);
  await page.click('#acc');
  await page.waitForTimeout(150);
  const steps = await finishRecording(page);

  await reopen(page, '/accordion');
  await execute(page, steps, 'Accordion');
  await waitDone(page, 20000);

  const state = await page.evaluate(() => ({
    expanded: document.getElementById('acc').getAttribute('aria-expanded'),
    toggles: window.__accToggles,
    hidden: document.getElementById('acc-panel').hidden,
  }));

  check('accordion: permanece aberto', state.expanded === 'true' && state.hidden === false, JSON.stringify(state));
  check('accordion: acionado uma única vez', state.toggles === 1, `alternâncias=${state.toggles}`);
  await page.close();
}

// ============================================================
// 6. Formulário
// ============================================================
{
  const page = await openFixture('/form');
  await startRecording(page);
  await page.fill('#name', 'Maria Silva');
  await page.selectOption('#days', '90');
  await page.click('#agree');
  await page.waitForTimeout(250);
  const steps = await finishRecording(page);
  check('formulário: três passos gravados', steps.length === 3, `passos=${steps.map((s) => s.action).join(',')}`);

  await reopen(page, '/form');
  await execute(page, steps, 'Formulário');
  await waitDone(page);

  const state = await page.evaluate(() => ({
    name: document.getElementById('name').value,
    days: document.getElementById('days').value,
    checked: document.getElementById('agree').checked,
    events: window.__events,
  }));

  check('formulário: texto preenchido', state.name === 'Maria Silva', state.name);
  check('formulário: select nativo aplicado', state.days === '90', state.days);
  check('formulário: checkbox marcado', state.checked === true);
  check(
    'formulário: eventos nativos disparados',
    state.events.some((e) => e.startsWith('input:')) && state.events.some((e) => e.startsWith('select:'))
  );
  await page.close();
}

// ============================================================
// 7. Modal
// ============================================================
{
  const page = await openFixture('/modal');
  await startRecording(page);
  await page.click('#open-modal');
  await page.waitForTimeout(150);
  await page.click('#confirm');
  await page.waitForTimeout(150);
  await page.click('#close-modal');
  await page.waitForTimeout(150);
  const steps = await finishRecording(page);
  check('modal: três passos gravados', steps.length === 3, `passos=${steps.length}`);

  await reopen(page, '/modal');
  await execute(page, steps, 'Modal');
  await waitDone(page);

  const state = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    hidden: document.getElementById('modal').hidden,
  }));

  check('modal: ação interna executada', state.status === 'confirmado', state.status);
  check('modal: fechado no fim', state.hidden === true);
  if (state.status !== 'confirmado') console.log((await engineLogs(page)).join('\n'));
  await page.close();
}

// ============================================================
// 8. Elemento com atraso
// ============================================================
{
  const page = await openFixture('/late');
  await startRecording(page);
  await page.waitForSelector('#late', { timeout: 5000 });
  await page.click('#late');
  await page.waitForTimeout(150);
  const steps = await finishRecording(page);

  await reopen(page, '/late');
  await execute(page, steps, 'Atrasado');
  await waitDone(page);

  const clicks = await page.evaluate(() => window.__lateClicks);
  check('elemento atrasado: clicado após aparecer', clicks === 1, `cliques=${clicks}`);
  await page.close();
}

// ============================================================
// 9. Label não duplica captura
// ============================================================
{
  const page = await openFixture('/label');
  await startRecording(page);
  await page.click('label[for="dup"]');
  await page.waitForTimeout(250);
  const steps = await finishRecording(page);
  check('label: não duplica captura', steps.length <= 2, `passos=${steps.length} (${steps.map((s) => s.action).join(',')})`);
  await page.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nRESULTADO: ${results.length - failed.length}/${results.length} verificações ok`);
if (failed.length) {
  console.log('FALHAS:');
  for (const item of failed) console.log(' - ' + item.name + (item.detail ? ' :: ' + item.detail : ''));
  process.exit(1);
}
