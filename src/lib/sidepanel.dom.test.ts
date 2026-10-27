import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { generateSidepanelHtml, generateSidepanelJs } from './extensionTemplates.ts';

/**
 * O painel lateral já abriu vazio porque `syncUI` acessava elementos sem checar
 * existência e o estado vinha corrompido. Estes testes garantem que os passos
 * salvos aparecem e que o menu de ações (+2s / editar / mover) funciona.
 */

interface SentMessage {
  type: string;
  [key: string]: unknown;
}

function createPanel(tasks: unknown[], activeTaskId: string) {
  const dom = new JSDOM(generateSidepanelHtml(), {
    runScripts: 'outside-only',
    url: 'chrome-extension://autoapprove/sidepanel.html',
  });

  // O painel se atualiza por setInterval; nos testes isso manteria o processo
  // vivo para sempre e mascararia falhas de asserção.
  (dom.window as unknown as { setInterval: () => number }).setInterval = () => 0;

  const sent: SentMessage[] = [];
  const savedTasks: Array<{ id: string; steps?: unknown[] }> = [];

  const stateReply = {
    ok: true,
    // Cópia profunda: o painel muta os passos ao inserir esperas
    tasks: JSON.parse(JSON.stringify(tasks)),
    activeTaskId,
    stats: { approved: 3, currentPage: 2, status: 'idle' },
    logs: [{ timestamp: '2026-01-01T10:00:00.000Z', level: 'info', message: 'Teste de log' }],
    workflow: { baseDelayMs: 500, randomJitterMs: 250 },
    recording: { active: false },
  };

  (dom.window as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage(message: SentMessage, callback?: (reply?: unknown) => void) {
        sent.push(message);

        if (message.type === 'GET_STATE') {
          if (callback) callback(stateReply);
          return Promise.resolve(stateReply);
        }

        if (message.type === 'SAVE_TASK' && message.task) {
          savedTasks.push(JSON.parse(JSON.stringify(message.task)) as { id: string; steps?: unknown[] });
        }

        const reply = { ok: true };
        if (callback) callback(reply);
        return Promise.resolve(reply);
      },
      getURL: (path: string) => `chrome-extension://autoapprove/${path}`,
      lastError: undefined,
    },
    storage: {
      onChanged: {
        addListener() {
          /* sem observação de storage nos testes */
        },
      },
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
      },
    },
  };

  vm.runInContext(generateSidepanelJs(), dom.getInternalVMContext());

  return { dom, sent, savedTasks };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

const TASK = {
  id: 'task-1',
  name: 'Aprovar acessos',
  category: 'IAM',
  pattern: 'free_macro',
  repeatMode: 'once',
  steps: [
    {
      id: 's1',
      order: 1,
      label: 'Clicar em Abrir detalhes',
      action: 'click',
      cssSelector: 'button[data-action="open"]',
      waitBeforeMs: 300,
      timeoutMs: 8000,
      isLoopTarget: false,
    },
    {
      id: 's2',
      order: 2,
      label: 'Escolher opção 90 dias',
      action: 'click',
      isOption: true,
      optionText: '90 dias',
      cssSelector: 'li:nth-of-type(2)',
      waitBeforeMs: 250,
      timeoutMs: 6000,
      isLoopTarget: false,
    },
  ],
};

test('painel lista os passos salvos da automação ativa', async () => {
  const { dom } = createPanel([TASK], TASK.id);
  await flush();

  const container = dom.window.document.getElementById('steps-list-container');
  assert.ok(container, 'Container de passos ausente');

  const html = container.innerHTML;
  assert.match(html, /Abrir detalhes/, 'O passo salvo não apareceu no painel');
  assert.match(html, /90 dias/, 'O passo de opção não apareceu no painel');
  assert.match(html, /#1/, 'Os passos não foram numerados');
  assert.match(html, /data-step-action="delay-quick"/, 'Faltou o atalho +2s por passo');

  dom.window.close();
});

test('painel mostra métricas e logs sem quebrar quando o estado chega', async () => {
  const { dom } = createPanel([TASK], TASK.id);
  await flush();

  const document = dom.window.document;
  assert.equal(document.getElementById('st-approved')?.textContent, '3');
  assert.equal(document.getElementById('st-page')?.textContent, '2');
  assert.match(document.getElementById('log-list')?.innerHTML || '', /Teste de log/);
  assert.equal(document.getElementById('steps-empty-state')?.style.display, 'none');

  dom.window.close();
});

test('painel lida com estado vazio sem lançar exceção', async () => {
  const { dom } = createPanel([], '');
  await flush();

  assert.equal(dom.window.document.getElementById('steps-empty-state')?.style.display, 'block');
  dom.window.close();
});

test('+2s no painel insere passo de espera e salva a automação', async () => {
  const { dom, savedTasks } = createPanel([TASK], TASK.id);
  await flush();

  const document = dom.window.document;
  const container = document.getElementById('steps-list-container') as HTMLElement;
  const quickDelay = container.querySelector('[data-step-action="delay-quick"]') as HTMLElement | null;

  assert.ok(quickDelay, 'Botão +2s não renderizado');

  quickDelay.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  const saved = savedTasks[savedTasks.length - 1];
  assert.ok(saved, 'A automação não foi salva após inserir a espera');

  const steps = (saved.steps || []) as Array<{ action?: string; value?: string | number; label?: string }>;
  const sleepStep = steps.find((step) => step.action === 'sleep');

  assert.ok(sleepStep, 'Nenhum passo de espera foi inserido');
  assert.equal(Number(sleepStep?.value), 2000, 'A espera deveria ser de 2000ms');
  assert.match(String(sleepStep?.label), /Aguardar 2s/);
  assert.equal(steps.length, TASK.steps.length + 1);

  dom.window.close();
});

test('⋮ abre o menu de ações completo do passo (espera, mover, duplicar, excluir)', async () => {
  const { dom } = createPanel([TASK], TASK.id);
  await flush();

  const document = dom.window.document;
  const container = document.getElementById('steps-list-container') as HTMLElement;
  const menuButton = container.querySelector('[data-step-action="toggle-menu"]') as HTMLElement | null;

  assert.ok(menuButton, 'Botão de menu (⋮) não renderizado');

  menuButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  const html = container.innerHTML;
  for (const action of ['delay-1', 'delay-5', 'delay-custom', 'edit-wait', 'move-up', 'move-down', 'duplicate', 'run-from', 'delete']) {
    assert.ok(
      html.includes(`data-step-action="${action}"`),
      `Ação ${action} ausente no menu do passo`
    );
  }

  dom.window.close();
});
