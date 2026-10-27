// AutoApprove RPA — Service Worker (Manifest V3)
// Orquestra tarefas, gravação multi-páginas e execução na aba ativa.
const DEFAULT_TASKS = __DEFAULT_TASKS_JSON__;
const DEFAULT_CONFIG = __DEFAULT_CONFIG_JSON__;

const STORAGE_KEYS = [
  'rpaTasks',
  'rpaActiveTaskId',
  'rpaWorkflow',
  'rpaLogs',
  'rpaStats',
  'rpaRecordingSession',
  'rpaExecutionSession',
];

function isTaskArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function setBadge(text, color) {
  try {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    chrome.action.setBadgeText({ text: text || '' });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch (err) {
    /* badge indisponível */
  }
}

async function readStorage(keys) {
  try {
    return (await chrome.storage.local.get(keys)) || {};
  } catch (err) {
    return {};
  }
}

async function writeStorage(payload) {
  try {
    await chrome.storage.local.set(payload);
  } catch (err) {
    /* storage cheio ou indisponível */
  }
}

async function resolveTargetTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    const allTabs = await chrome.tabs.query({});
    tab = allTabs[0];
  }
  return tab || null;
}

async function sendToTab(tabId, message, injectIfMissing) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!injectIfMissing) return null;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectError) {
      console.warn('[AutoApprove] Content script indisponível nesta aba:', injectError);
      return null;
    }
  }
}

function logEntry(level, message) {
  return {
    id: 'bg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    timestamp: new Date().toISOString(),
    level: level || 'info',
    message: String(message == null ? '' : message),
  };
}

async function pushLog(level, message) {
  const { rpaLogs = [] } = await readStorage('rpaLogs');
  const logs = Array.isArray(rpaLogs) ? rpaLogs : [];
  const next = [logEntry(level, message), ...logs].slice(0, 400);
  await writeStorage({ rpaLogs: next });
}

// ==========================================
// INSTALAÇÃO / ATUALIZAÇÃO
// ==========================================
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await readStorage(STORAGE_KEYS);

  if (!isTaskArray(stored.rpaTasks)) {
    await writeStorage({ rpaTasks: DEFAULT_TASKS });
  }

  const tasks = isTaskArray(stored.rpaTasks) ? stored.rpaTasks : DEFAULT_TASKS;
  if (!stored.rpaActiveTaskId || !tasks.some((task) => task.id === stored.rpaActiveTaskId)) {
    await writeStorage({ rpaActiveTaskId: tasks[0] && tasks[0].id });
  }

  if (!stored.rpaWorkflow || typeof stored.rpaWorkflow !== 'object') {
    await writeStorage({ rpaWorkflow: DEFAULT_CONFIG });
  }
  if (!Array.isArray(stored.rpaLogs)) {
    await writeStorage({ rpaLogs: [] });
  }
  if (!stored.rpaStats) {
    await writeStorage({
      rpaStats: { status: 'idle', approved: 0, failed: 0, currentPage: 1, totalItems: 0, activeTabId: null },
    });
  }
  if (!stored.rpaRecordingSession) {
    await writeStorage({ rpaRecordingSession: { active: false } });
  }

  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    /* sidePanel exige Chrome 114+ */
  }
});

// ==========================================
// RETOMADA APÓS NAVEGAÇÃO / RECARGA (F5, links, submits)
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

  const { rpaRecordingSession } = await readStorage(['rpaRecordingSession']);

  try {
    if (rpaRecordingSession && rpaRecordingSession.active) {
      // Só a GRAVAÇÃO é retomada aqui.
      await sendToTab(tabId, { type: 'RPA_RESUME_RECORDING', session: rpaRecordingSession }, true);
    }

    // A retomada de EXECUÇÃO é responsabilidade exclusiva do content script
    // (que consome a marcação "resumable" e sabe o passo exato). Reenviar o
    // comando por aqui duplicava o início e fazia o fluxo começar do meio.
  } catch (err) {
    console.warn('[AutoApprove] Falha ao retomar gravação na aba:', err);
  }
});

// ==========================================
// HEARTBEAT
// ==========================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'rpa-heartbeat') return;

  const { rpaStats } = await readStorage('rpaStats');
  if (!rpaStats || rpaStats.status !== 'running' || !rpaStats.activeTabId) return;

  try {
    await chrome.tabs.sendMessage(rpaStats.activeTabId, { type: 'RPA_PING' });
  } catch (err) {
    await writeStorage({ rpaStats: { ...rpaStats, status: 'idle' } });
    await pushLog('warn', 'Aba de execução não respondeu; estado marcado como ocioso.');
  }
});

// ==========================================
// MENSAGENS DO SIDE PANEL / POPUP
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: 'Mensagem inválida.' });
      return;
    }

    if (message.type === 'GET_STATE') {
      const state = await readStorage(STORAGE_KEYS);
      const tasks = Array.isArray(state.rpaTasks) ? state.rpaTasks : [];
      sendResponse({
        ok: true,
        tasks: tasks,
        activeTaskId: state.rpaActiveTaskId,
        stats: state.rpaStats || {},
        logs: state.rpaLogs || [],
        workflow: state.rpaWorkflow || DEFAULT_CONFIG,
        recording: state.rpaRecordingSession || { active: false },
      });
      return;
    }

    if (message.type === 'SET_ACTIVE_TASK') {
      await writeStorage({ rpaActiveTaskId: message.taskId });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'SAVE_TASK') {
      const task = message.task;
      if (!task || !task.id) {
        sendResponse({ ok: false, error: 'Tarefa inválida.' });
        return;
      }

      const { rpaTasks = [] } = await readStorage('rpaTasks');
      const tasks = Array.isArray(rpaTasks) ? rpaTasks.slice() : [];
      const index = tasks.findIndex((item) => item.id === task.id);

      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.unshift(task);
      }

      await writeStorage({ rpaTasks: tasks, rpaActiveTaskId: task.id });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'DELETE_TASK') {
      const { rpaTasks = [] } = await readStorage('rpaTasks');
      const tasks = (Array.isArray(rpaTasks) ? rpaTasks : []).filter((task) => task.id !== message.taskId);
      const nextActive = tasks[0] ? tasks[0].id : null;
      await writeStorage({ rpaTasks: tasks.length > 0 ? tasks : DEFAULT_TASKS, rpaActiveTaskId: nextActive });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'START_BATCH_EXECUTION') {
      const tab = await resolveTargetTab();
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'Nenhuma aba ativa encontrada.' });
        return;
      }

      const { rpaTasks = [], rpaActiveTaskId, rpaWorkflow = {}, rpaStats = {} } = await readStorage([
        'rpaTasks',
        'rpaActiveTaskId',
        'rpaWorkflow',
        'rpaStats',
      ]);

      const tasks = Array.isArray(rpaTasks) && rpaTasks.length > 0 ? rpaTasks : DEFAULT_TASKS;
      const activeTask =
        tasks.find((task) => task.id === rpaActiveTaskId) || tasks[0] || null;

      if (!activeTask) {
        sendResponse({ ok: false, error: 'Nenhuma automação configurada.' });
        return;
      }

      if (!Array.isArray(activeTask.steps) || activeTask.steps.length === 0) {
        sendResponse({ ok: false, error: 'Esta automação ainda não tem passos gravados.' });
        return;
      }

      const startStepIdx = Number(message.startStepIdx) || 0;

      try {
        await chrome.alarms.create('rpa-heartbeat', { periodInMinutes: 1 });
      } catch (err) {
        /* alarme já existe */
      }

      await writeStorage({
        rpaStats: { ...rpaStats, status: 'running', activeTabId: tab.id },
      });

      const response = await sendToTab(
        tab.id,
        {
          type: 'RPA_EXECUTE_TASK',
          task: activeTask,
          config: rpaWorkflow,
          startStepIdx: startStepIdx,
        },
        true
      );

      if (!response) {
        await writeStorage({ rpaStats: { ...rpaStats, status: 'idle' } });
        sendResponse({
          ok: false,
          error: 'Não foi possível falar com a página. Recarregue a aba alvo e tente novamente.',
        });
        return;
      }

      sendResponse({ ok: true, tabId: tab.id, taskId: activeTask.id, startStepIdx: startStepIdx });
      return;
    }

    if (message.type === 'PAUSE_BATCH_EXECUTION' || message.type === 'RESUME_BATCH_EXECUTION') {
      const { rpaStats = {} } = await readStorage('rpaStats');
      if (rpaStats.activeTabId) {
        await sendToTab(
          rpaStats.activeTabId,
          { type: message.type === 'PAUSE_BATCH_EXECUTION' ? 'RPA_PAUSE' : 'RPA_RESUME' },
          false
        );
      }
      await writeStorage({
        rpaStats: {
          ...rpaStats,
          status: message.type === 'PAUSE_BATCH_EXECUTION' ? 'paused' : 'running',
        },
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'STOP_BATCH_EXECUTION') {
      const { rpaStats = {} } = await readStorage('rpaStats');

      if (rpaStats.activeTabId) {
        await sendToTab(rpaStats.activeTabId, { type: 'RPA_ABORT' }, false);
      }

      try {
        await chrome.alarms.clear('rpa-heartbeat');
      } catch (err) {
        /* ignore */
      }

      await writeStorage({
        rpaStats: { ...rpaStats, status: 'idle' },
        rpaExecutionSession: { active: false },
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'START_RECORDING_WIZARD') {
      const tab = await resolveTargetTab();
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'Nenhuma aba ativa encontrada.' });
        return;
      }

      const { rpaActiveTaskId, rpaTasks = [] } = await readStorage(['rpaActiveTaskId', 'rpaTasks']);
      const tasks = Array.isArray(rpaTasks) ? rpaTasks : [];
      const targetTaskId =
        message.taskId || rpaActiveTaskId || (tasks[0] && tasks[0].id) || 'task-free-recorder';

      const session = {
        active: true,
        mode: message.mode || 'free',
        taskId: targetTaskId,
        tabId: tab.id,
        status: 'recording',
        recordedSteps: [],
        wizardPhase: message.mode === 'list_wizard' ? 'list_row' : null,
        wizardListConfig: {},
        lastUrl: tab.url || '',
        lastPageTitle: tab.title || '',
        startedAt: new Date().toISOString(),
        hudMinimized: false,
      };

      await writeStorage({ rpaRecordingSession: session });
      setBadge('REC', '#ef4444');

      const response = await sendToTab(
        tab.id,
        { type: 'RPA_START_RECORDING', mode: message.mode || 'free', taskId: targetTaskId },
        true
      );

      if (!response) {
        await writeStorage({ rpaRecordingSession: { active: false } });
        setBadge('');
        sendResponse({
          ok: false,
          error: 'Não foi possível iniciar a gravação nesta aba (página restrita do navegador?).',
        });
        return;
      }

      sendResponse({ ok: true, tabId: tab.id, taskId: targetTaskId });
      return;
    }

    if (message.type === 'SYNC_RECORDING_STEP') {
      if (typeof message.stepCount === 'number') {
        setBadge(String(message.stepCount), '#ef4444');
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'CANCEL_RECORDING_SESSION') {
      await writeStorage({ rpaRecordingSession: { active: false } });
      setBadge('');
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'SAVE_RECORDED_STEPS') {
      const { rpaTasks = [], rpaActiveTaskId } = await readStorage(['rpaTasks', 'rpaActiveTaskId']);
      const tasks = Array.isArray(rpaTasks) ? rpaTasks.slice() : [];
      const targetId = message.taskId || rpaActiveTaskId || (tasks[0] && tasks[0].id);
      const steps = Array.isArray(message.steps) ? message.steps : [];

      const index = tasks.findIndex((task) => task.id === targetId);

      if (index >= 0) {
        tasks[index] = {
          ...tasks[index],
          steps: steps,
          listConfig: message.listConfig || tasks[index].listConfig,
        };
      } else {
        // Gravação sem tarefa de destino: cria uma para não perder os passos.
        tasks.unshift({
          id: targetId || 'task-recorded-' + Date.now(),
          name: 'Automação gravada',
          description: 'Criada automaticamente a partir de uma gravação.',
          category: 'Personalizado',
          pattern: 'free_macro',
          targetUrl: '',
          repeatMode: 'once',
          steps: steps,
          listConfig: message.listConfig,
        });
      }

      await writeStorage({
        rpaTasks: tasks,
        rpaActiveTaskId: targetId,
        rpaRecordingSession: { active: false },
      });
      setBadge('');
      await pushLog('success', 'Gravação salva com ' + steps.length + ' passo(s).');
      sendResponse({ ok: true, steps: steps.length });
      return;
    }

    if (message.type === 'UPDATE_STATS') {
      const { rpaStats = {}, rpaLogs = [] } = await readStorage(['rpaStats', 'rpaLogs']);
      const logs = Array.isArray(rpaLogs) ? rpaLogs : [];

      const nextStats = { ...rpaStats, ...(message.patch || {}) };
      const nextLogs = message.logEntry
        ? [message.logEntry, ...logs].slice(0, 400)
        : logs;

      await writeStorage({ rpaStats: nextStats, rpaLogs: nextLogs });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Tipo de mensagem desconhecido: ' + message.type });
  })().catch((err) => {
    console.error('[AutoApprove] Erro no service worker:', err);
    try {
      sendResponse({ ok: false, error: String(err) });
    } catch (sendErr) {
      /* canal já fechado */
    }
  });

  return true;
});
