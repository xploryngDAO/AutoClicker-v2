/**
 * Contrato do service worker (background.js) com o painel e o content script.
 *
 * Cobre o caminho que nenhum teste de DOM alcança: mensagem do painel →
 * gravação → persistência da tarefa → execução. Um erro aqui aparece para o
 * usuário como "gravei, mas não executa".
 *
 * Uso: node tests/node/background.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateBackgroundJs } from '../../src/lib/extensionTemplates.ts';
import { getDefaultConfig, getDefaultTasks } from '../../src/lib/seedData.ts';

function createChromeStub() {
  const storage = {};
  const messagesToTabs = [];
  const listeners = [];

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) out[key] = storage[key];
          return out;
        },
        async set(payload) {
          Object.assign(storage, payload);
        },
        onChanged: { addListener() {} },
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
      lastError: undefined,
    },
    tabs: {
      async query() {
        return [{ id: 7, windowId: 1, url: 'https://portal.test/iam', title: 'Portal' }];
      },
      async sendMessage(tabId, message) {
        messagesToTabs.push({ tabId, message });
        return { ok: true };
      },
      onUpdated: { addListener() {} },
    },
    scripting: { async executeScript() {} },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    alarms: { async create() {}, async clear() {}, onAlarm: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    notifications: {},
  };

  return { chrome, storage, messagesToTabs, listeners };
}

function bootWorker(tasks = getDefaultTasks(), config = getDefaultConfig()) {
  const stub = createChromeStub();
  const source = generateBackgroundJs(tasks, config);

  const context = vm.createContext({
    chrome: stub.chrome,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
  });

  vm.runInContext(source, context, { filename: 'background.js' });

  function send(message) {
    return new Promise((resolve) => {
      for (const listener of stub.listeners) {
        listener(message, {}, resolve);
      }
    });
  }

  return { ...stub, send, source };
}

test('background gera código válido e injeta as tarefas padrão', () => {
  const worker = bootWorker();
  assert.ok(worker.source.includes('chrome.tabs.onUpdated.addListener'));
  assert.ok(!worker.source.includes('__DEFAULT_TASKS_JSON__'));
  assert.ok(worker.source.includes('RPA_START_RECORDING'));
});

test('gravação: inicia sessão, recebe passos e salva na tarefa', async () => {
  const worker = bootWorker();

  const started = await worker.send({ type: 'START_RECORDING_WIZARD', mode: 'free' });
  assert.equal(started.ok, true);

  const session = worker.storage.rpaRecordingSession;
  assert.equal(session.active, true);
  assert.equal(session.mode, 'free');

  const sentStart = worker.messagesToTabs.find((m) => m.message.type === 'RPA_START_RECORDING');
  assert.ok(sentStart, 'O content script não recebeu RPA_START_RECORDING');
  assert.equal(sentStart.tabId, 7);

  // O content script envia os passos ao salvar
  const steps = [
    { id: 's1', order: 1, label: 'Abrir', action: 'click', cssSelector: '#a', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false },
    { id: 's2', order: 2, label: 'Confirmar', action: 'click', cssSelector: '#b', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false },
  ];

  const saved = await worker.send({
    type: 'SAVE_RECORDED_STEPS',
    taskId: session.taskId,
    steps,
    listConfig: {},
  });
  assert.equal(saved.ok, true);

  const tasks = worker.storage.rpaTasks;
  assert.ok(Array.isArray(tasks), 'rpaTasks deveria ser lista');
  const task = tasks.find((item) => item.id === session.taskId);
  assert.ok(task, 'Tarefa da gravação não encontrada');
  assert.equal(task.steps.length, 2, `Esperado 2 passos salvos, obtidos ${task.steps?.length}`);
  assert.equal(task.steps[0].cssSelector, '#a');
  assert.equal(worker.storage.rpaRecordingSession.active, false);
});

test('execução: envia a tarefa com todos os passos e começa no índice 0', async () => {
  const worker = bootWorker();

  await worker.send({ type: 'START_RECORDING_WIZARD', mode: 'free' });
  const session = worker.storage.rpaRecordingSession;

  await worker.send({
    type: 'SAVE_RECORDED_STEPS',
    taskId: session.taskId,
    steps: [
      { id: 's1', order: 1, label: 'Um', action: 'click', cssSelector: '#b1', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false },
      { id: 's2', order: 2, label: 'Dois', action: 'click', cssSelector: '#b2', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false },
      { id: 's3', order: 3, label: 'Três', action: 'click', cssSelector: '#b3', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false },
    ],
    listConfig: {},
  });

  const executed = await worker.send({ type: 'START_BATCH_EXECUTION' });
  assert.equal(executed.ok, true);

  const command = worker.messagesToTabs
    .filter((m) => m.message.type === 'RPA_EXECUTE_TASK')
    .pop();

  assert.ok(command, 'RPA_EXECUTE_TASK não foi enviado para a aba');
  assert.equal(command.message.startStepIdx, 0, 'A execução deve começar no passo 0');
  assert.equal(command.message.task.steps.length, 3);
  assert.equal(command.message.task.steps[2].cssSelector, '#b3');
  assert.equal(worker.storage.rpaStats.status, 'running');
});

test('execução com fila de tarefas corrompida não quebra', async () => {
  const worker = bootWorker();

  // Estado legado/estragado: rpaTasks não é lista
  worker.storage.rpaTasks = 'lixo';

  const executed = await worker.send({ type: 'START_BATCH_EXECUTION' });
  assert.equal(executed.ok, true, 'Deveria usar as tarefas padrão e seguir');

  const command = worker.messagesToTabs.find((m) => m.message.type === 'RPA_EXECUTE_TASK');
  assert.ok(command, 'Nenhuma execução enviada');
  assert.ok(Array.isArray(command.message.task.steps));
});

test('parar limpa a sessão de execução e o alarme', async () => {
  const worker = bootWorker();

  await worker.send({ type: 'START_BATCH_EXECUTION' });
  const stopped = await worker.send({ type: 'STOP_BATCH_EXECUTION' });

  assert.equal(stopped.ok, true);
  assert.equal(worker.storage.rpaStats.status, 'idle');
  assert.equal(worker.storage.rpaExecutionSession.active, false);

  const abort = worker.messagesToTabs.find((m) => m.message.type === 'RPA_ABORT');
  assert.ok(abort, 'A aba não recebeu RPA_ABORT');
});

test('pausar e retomar refletem no estado da execução', async () => {
  const worker = bootWorker();

  await worker.send({ type: 'START_BATCH_EXECUTION' });

  await worker.send({ type: 'PAUSE_BATCH_EXECUTION' });
  assert.equal(worker.storage.rpaStats.status, 'paused');
  assert.ok(worker.messagesToTabs.some((m) => m.message.type === 'RPA_PAUSE'));

  await worker.send({ type: 'RESUME_BATCH_EXECUTION' });
  assert.equal(worker.storage.rpaStats.status, 'running');
  assert.ok(worker.messagesToTabs.some((m) => m.message.type === 'RPA_RESUME'));
});

test('gravação sem tarefa de destino cria a automação em vez de perder os passos', async () => {
  const worker = bootWorker();

  await worker.send({
    type: 'SAVE_RECORDED_STEPS',
    taskId: 'task-inexistente',
    steps: [{ id: 's1', order: 1, label: 'Único', action: 'click', cssSelector: '#x', waitBeforeMs: 0, timeoutMs: 2000, isLoopTarget: false }],
    listConfig: {},
  });

  const created = worker.storage.rpaTasks.find((item) => item.id === 'task-inexistente');
  assert.ok(created, 'A tarefa deveria ser criada automaticamente');
  assert.equal(created.steps.length, 1);
});
