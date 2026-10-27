import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { generateContentJs } from './extensionTemplates.ts';

/**
 * Testes de comportamento do content script em um DOM real (jsdom).
 *
 * Cobrem exatamente as falhas relatadas em produção:
 *  - o HUD (modal de gravação) não aparecia;
 *  - o menu de ações por passo (+2s) não existia;
 *  - o dropdown abria e fechava sozinho durante a execução, impedindo a
 *    seleção da opção.
 */

interface Harness {
  dom: JSDOM;
  window: JSDOM['window'];
  document: Document;
  storage: Record<string, unknown>;
  send: (message: Record<string, unknown>) => void;
}

interface ContentListener {
  (message: Record<string, unknown>, sender: unknown, sendResponse: (reply?: unknown) => void): unknown;
}

function createHarness(bodyHtml: string): Harness {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://portal.example.test/iam',
  });

  const { window } = dom;

  // jsdom não faz layout: sem dimensões, todo elemento pareceria invisível.
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 120,
      height: 32,
      top: 10,
      left: 10,
      right: 130,
      bottom: 42,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect;
  };

  const storage: Record<string, unknown> = {};
  const listeners: ContentListener[] = [];

  (window as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get(keys: string | string[], callback?: (result: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of list) result[key] = storage[key];
          if (typeof callback === 'function') callback(result);
          return Promise.resolve(result);
        },
        set(payload: Record<string, unknown>, callback?: () => void) {
          Object.assign(storage, payload);
          if (typeof callback === 'function') callback();
          return Promise.resolve();
        },
      },
    },
    runtime: {
      sendMessage(_message: unknown, callback?: (reply?: unknown) => void) {
        if (typeof callback === 'function') callback({ ok: true });
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener(listener: ContentListener) {
          listeners.push(listener);
        },
      },
      lastError: undefined,
    },
  };

  vm.runInContext(generateContentJs(), dom.getInternalVMContext());

  return {
    dom,
    window,
    document: window.document,
    storage,
    send(message) {
      for (const listener of listeners) {
        listener(message, {}, () => undefined);
      }
    },
  };
}

function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let matched = false;
      try {
        matched = predicate();
      } catch {
        matched = false;
      }
      if (matched) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Tempo esgotado aguardando a condição do teste.'));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('HUD de gravação é injetado na página ao iniciar a gravação', () => {
  const harness = createHarness('<button id="start">Iniciar</button>');
  harness.send({ type: 'RPA_START_RECORDING', mode: 'free', taskId: 'task-1' });

  const hud = harness.document.getElementById('autoapprove-hud');
  assert.ok(hud, 'O modal/HUD de gravação não foi injetado na página');
  assert.match(hud.innerHTML, /Gravação na Tela/i, 'HUD sem título de gravação');
  assert.match(hud.innerHTML, /Salvar gravação/i, 'HUD sem botão de salvar');
});

test('clique na página é capturado e aparece na lista do HUD', () => {
  const harness = createHarness('<button id="approve">Aprovar acesso</button>');
  harness.send({ type: 'RPA_START_RECORDING', mode: 'free', taskId: 'task-1' });

  const button = harness.document.getElementById('approve') as HTMLButtonElement;
  button.dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 })
  );

  const hud = harness.document.getElementById('autoapprove-hud');
  assert.ok(hud, 'HUD ausente após iniciar gravação');
  assert.match(hud.innerHTML, /Aprovar acesso/, 'O clique gravado não apareceu no HUD');
  assert.match(hud.innerHTML, /#1/, 'O passo gravado não recebeu numeração');
});

test('o menu de ações do passo oferece +2s e insere a espera', () => {
  const harness = createHarness('<button id="approve">Aprovar acesso</button>');
  harness.send({ type: 'RPA_START_RECORDING', mode: 'free', taskId: 'task-1' });

  const button = harness.document.getElementById('approve') as HTMLButtonElement;
  button.dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 })
  );

  const hud = harness.document.getElementById('autoapprove-hud');
  assert.ok(hud, 'HUD ausente');

  // Atalho direto de +2s em cada passo
  const quickDelay = hud.querySelector('[data-hud-act="delay-2"]') as HTMLElement | null;
  assert.ok(quickDelay, 'Faltou o botão +2s no passo gravado');

  quickDelay.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  assert.match(hud.innerHTML, /Aguardar 2s/, 'A espera de 2s não foi inserida na gravação');

  // Menu completo (⋮) continua disponível
  const menuButton = hud.querySelector('[data-hud-act="menu"]') as HTMLElement | null;
  assert.ok(menuButton, 'Faltou o botão de menu de ações (⋮)');
  menuButton.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  assert.match(hud.innerHTML, /aahud-step-menu/, 'O menu de ações não abriu');
  assert.match(hud.innerHTML, /Espera antes/, 'Menu sem a ação de espera antes do passo');
  assert.match(hud.innerHTML, /Excluir/, 'Menu sem a ação de excluir');
});

test('execução abre o dropdown uma única vez e seleciona a opção', async () => {
  const harness = createHarness(`
    <button id="combo" role="combobox" aria-expanded="false" aria-haspopup="listbox">Plano</button>
    <ul id="menu" role="listbox" style="display:none">
      <li role="option" data-value="a">Opção A</li>
      <li role="option" data-value="b">Opção B</li>
    </ul>
  `);

  const { document, window } = harness;
  const combo = document.getElementById('combo') as HTMLButtonElement;
  const menu = document.getElementById('menu') as HTMLUListElement;

  let toggleCount = 0;

  // Componente que alterna tanto no mousedown quanto no click (MUI, Radix,
  // react-select). Era esse perfil que "abria e fechava" na execução antiga.
  const toggle = () => {
    toggleCount += 1;
    const isOpen = combo.getAttribute('aria-expanded') === 'true';
    combo.setAttribute('aria-expanded', String(!isOpen));
    menu.style.display = isOpen ? 'none' : 'block';
  };

  combo.addEventListener('mousedown', toggle);
  combo.addEventListener('click', toggle);

  menu.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest('[role="option"]');
    if (!option) return;
    combo.textContent = option.textContent;
    combo.setAttribute('aria-expanded', 'false');
    menu.style.display = 'none';
  });

  harness.send({
    type: 'RPA_EXECUTE_TASK',
    config: { baseDelayMs: 0, randomJitterMs: 0 },
    task: {
      id: 'task-1',
      name: 'Selecionar plano',
      pattern: 'free_macro',
      repeatMode: 'once',
      steps: [
        {
          id: 's1',
          order: 1,
          label: 'Abrir caixa de seleção Plano',
          action: 'click',
          isCombobox: true,
          cssSelector: '#combo',
          waitBeforeMs: 0,
          timeoutMs: 3000,
          isLoopTarget: false,
        },
        {
          id: 's2',
          order: 2,
          label: 'Escolher opção Opção B',
          action: 'click',
          isOption: true,
          optionText: 'Opção B',
          parentTriggerSelector: '#combo',
          cssSelector: '#menu li:nth-child(2)',
          waitBeforeMs: 0,
          timeoutMs: 3000,
          isLoopTarget: false,
        },
      ],
    },
  });

  await waitUntil(() => (combo.textContent || '').includes('Opção B'), 8000);

  assert.equal(combo.textContent?.trim(), 'Opção B', 'A opção do dropdown não foi aplicada');
  assert.equal(menu.style.display, 'none', 'O menu deveria estar fechado após a seleção');
  assert.equal(combo.getAttribute('aria-expanded'), 'false');
  assert.equal(toggleCount, 1, 'O dropdown foi alternado mais de uma vez (abriu e fechou)');
});

test('clique comum dispara exatamente um evento de clique', async () => {
  const harness = createHarness('<button id="save">Salvar</button>');
  const { document } = harness;

  const save = document.getElementById('save') as HTMLButtonElement;
  let clicks = 0;
  let mouseDowns = 0;

  save.addEventListener('click', () => {
    clicks += 1;
  });
  save.addEventListener('mousedown', () => {
    mouseDowns += 1;
  });

  harness.send({
    type: 'RPA_EXECUTE_TASK',
    config: { baseDelayMs: 0, randomJitterMs: 0 },
    task: {
      id: 'task-2',
      name: 'Salvar',
      pattern: 'free_macro',
      repeatMode: 'once',
      steps: [
        {
          id: 's1',
          order: 1,
          label: 'Clicar em Salvar',
          action: 'click',
          cssSelector: '#save',
          waitBeforeMs: 0,
          timeoutMs: 3000,
          isLoopTarget: false,
        },
      ],
    },
  });

  await waitUntil(() => clicks > 0, 8000);
  // Dá tempo para um eventual segundo clique chegar
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(clicks, 1, `Esperado 1 clique, recebidos ${clicks}`);
  assert.equal(mouseDowns, 1, `Esperado 1 mousedown, recebidos ${mouseDowns}`);
});
