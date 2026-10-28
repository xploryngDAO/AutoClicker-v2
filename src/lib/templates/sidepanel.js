// AutoApprove RPA — Controlador do painel lateral
// Seletor de tarefas, editor de passos (com ações por passo), execução e logs.
(function () {
  'use strict';

  var state = {
    tasks: [],
    activeTask: null,
    stats: {},
    logs: [],
    workflow: {},
    recording: { active: false },
    background: null,
    openStepId: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var element = $(id);
    if (element) element.textContent = value == null ? '' : String(value);
  }

  function sendMessage(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          // Consome "Receiving end does not exist" para não poluir o console
          void chrome.runtime.lastError;
          resolve(response || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function makeId(prefix) {
    return (prefix || 'step') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  }

  function renumber(steps) {
    steps.forEach(function (step, index) {
      step.order = index + 1;
    });
  }

  function delaySecondsOf(step) {
    var ms = Number(step && step.value);
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 2;
  }

  // ==========================================
  // RENDERIZAÇÃO
  // ==========================================

  function renderTasks() {
    var select = $('select-active-task');
    if (!select) return;

    if (state.tasks.length === 0) {
      select.innerHTML = '<option value="">Nenhuma automação</option>';
      return;
    }

    select.innerHTML = state.tasks
      .map(function (task) {
        var selected = state.activeTask && state.activeTask.id === task.id ? ' selected' : '';
        return '<option value="' + escapeHtml(task.id) + '"' + selected + '>' + escapeHtml(task.name) + '</option>';
      })
      .join('');
  }

  function renderTaskMeta() {
    var task = state.activeTask;

    setText('task-badge-category', task ? task.category || 'Geral' : '—');
    setText(
      'task-badge-pattern',
      task
        ? task.pattern === 'list_detail_pagination'
          ? 'Tabela com paginação'
          : task.pattern === 'form_submission'
            ? 'Formulário'
            : 'Macro livre'
        : '—'
    );
    setText('task-steps-count', (task && task.steps ? task.steps.length : 0) + ' passos');
    setText('steps-task-title', task ? task.name : 'Passos gravados');

    var repeatMode = task ? task.repeatMode : 'once';
    var once = $('rep-once');
    var repeatN = $('rep-n');
    var loop = $('rep-loop');
    var count = $('input-repeat-count');

    if (once) once.checked = repeatMode === 'once';
    if (repeatN) repeatN.checked = repeatMode === 'repeat_n';
    if (loop) loop.checked = repeatMode === 'loop_list';
    if (count && task && task.repeatCount) count.value = String(task.repeatCount);
  }

  function stepKindLabel(step) {
    if (!step) return 'passo';
    if (step.action === 'sleep') return 'espera';
    if (step.action === 'navigate') return 'navegar';
    if (step.action === 'wait_visible') return 'aguardar';
    if (step.isOption) return 'opção';
    return step.action || 'clique';
  }

  function renderStepsList(steps, isLive) {
    var container = $('steps-list-container');
    var emptyState = $('steps-empty-state');
    if (!container) return;

    var list = Array.isArray(steps) ? steps : [];

    if (emptyState) emptyState.style.display = list.length === 0 ? 'block' : 'none';
    container.innerHTML = '';

    if (list.length === 0) return;

    var html = list
      .map(function (step, index) {
        var isOpen = state.openStepId === step.id;
        var waitBefore = Number(step.waitBeforeMs) || 0;
        var waitLabel = step.action === 'sleep' ? 'espera ' + delaySecondsOf(step) + 's' : 'espera antes ' + waitBefore + 'ms';

        var selectorLine = step.cssSelector
          ? '<span class="step-selector" title="' + escapeHtml(step.cssSelector) + '">' + escapeHtml(step.cssSelector) + '</span>'
          : step.value
            ? '<span class="step-selector" title="' + escapeHtml(step.value) + '">' + escapeHtml(step.value) + '</span>'
            : '';

        var quickActions = isLive
          ? ''
          : '<div class="step-quick">' +
              '<button type="button" class="step-icon-btn is-accent" data-step-action="delay-quick" data-step-id="' + escapeHtml(step.id) + '" title="Adicionar 2 segundos de espera depois deste passo">+2s</button>' +
              '<button type="button" class="step-icon-btn" data-step-action="toggle-menu" data-step-id="' + escapeHtml(step.id) + '" title="Mais ações">⋮</button>' +
            '</div>';

        var actionBar = isLive
          ? ''
          : '<div class="step-actions"' + (isOpen ? '' : ' hidden') + '>' +
              '<button type="button" class="step-action-btn" data-step-action="delay-1" data-step-id="' + escapeHtml(step.id) + '">+1s</button>' +
              '<button type="button" class="step-action-btn" data-step-action="delay-2" data-step-id="' + escapeHtml(step.id) + '">+2s</button>' +
              '<button type="button" class="step-action-btn" data-step-action="delay-5" data-step-id="' + escapeHtml(step.id) + '">+5s</button>' +
              '<button type="button" class="step-action-btn" data-step-action="delay-custom" data-step-id="' + escapeHtml(step.id) + '">Espera…</button>' +
              '<button type="button" class="step-action-btn" data-step-action="edit-wait" data-step-id="' + escapeHtml(step.id) + '">Espera antes…</button>' +
              '<button type="button" class="step-action-btn" data-step-action="move-up" data-step-id="' + escapeHtml(step.id) + '">↑ Subir</button>' +
              '<button type="button" class="step-action-btn" data-step-action="move-down" data-step-id="' + escapeHtml(step.id) + '">↓ Descer</button>' +
              '<button type="button" class="step-action-btn" data-step-action="duplicate" data-step-id="' + escapeHtml(step.id) + '">Duplicar</button>' +
              '<button type="button" class="step-action-btn" data-step-action="run-from" data-step-id="' + escapeHtml(step.id) + '">▶ Daqui</button>' +
              '<button type="button" class="step-action-btn is-danger" data-step-action="delete" data-step-id="' + escapeHtml(step.id) + '">Excluir</button>' +
            '</div>';

        return (
          '<div class="step-item' + (isOpen ? ' is-open' : '') + '" data-step-id="' + escapeHtml(step.id) + '">' +
            '<div class="step-main">' +
              '<span class="step-badge-order">#' + (index + 1) + '</span>' +
              '<div class="step-text">' +
                '<strong class="step-title">[' + escapeHtml(stepKindLabel(step).toUpperCase()) + '] ' + escapeHtml(step.label || 'Passo') + '</strong>' +
                selectorLine +
                '<span class="step-meta">' + escapeHtml(waitLabel) + (isLive ? ' · gravando' : '') + '</span>' +
              '</div>' +
              quickActions +
            '</div>' +
            actionBar +
          '</div>'
        );
      })
      .join('');

    if (isLive) {
      html =
        '<div style="background:#1e293b;color:#38bdf8;padding:5px 8px;border-radius:8px;font-size:11px;font-weight:700">' +
        '🔴 Passos em tempo real (gravação em andamento)</div>' +
        html;
    }

    container.innerHTML = html;
  }

  function renderSteps() {
    var task = state.activeTask;
    var recording = state.recording || {};
    var liveSteps =
      recording.active && task && recording.taskId === task.id && Array.isArray(recording.recordedSteps)
        ? recording.recordedSteps
        : null;

    if (liveSteps && liveSteps.length > 0) {
      renderStepsList(liveSteps, true);
      return;
    }

    renderStepsList(task && Array.isArray(task.steps) ? task.steps : [], false);
  }

  function renderRecordingBanner() {
    var banner = $('live-recording-banner');
    var recording = state.recording || {};

    if (!banner) return;

    if (recording.active) {
      banner.style.display = 'block';
      var count = Array.isArray(recording.recordedSteps) ? recording.recordedSteps.length : 0;
      setText('rec-banner-title', recording.status === 'paused' ? 'Gravação em pausa' : 'Gravação ativa na tela');
      setText(
        'rec-banner-sub',
        count + ' passo' + (count === 1 ? '' : 's') + ' capturado' + (count === 1 ? '' : 's')
      );
    } else {
      banner.style.display = 'none';
    }
  }

  function renderMetrics() {
    var stats = state.stats || {};

    setText('st-approved', stats.approved || 0);
    setText('st-page', stats.currentPage || 1);

    var label = stats.status === 'running' ? 'Executando' : stats.status === 'paused' ? 'Pausado' : 'Pronto';
    setText('st-status', label);

    if (state.background) {
      setText('st-status-sub', 'janela separada');
    } else if (stats.status === 'running') {
      setText('st-status-sub', 'não feche a aba');
    } else {
      setText('st-status-sub', 'aguardando início');
    }
  }

  function renderLogs() {
    var box = $('log-list');
    if (!box) return;

    var logs = Array.isArray(state.logs) ? state.logs.slice(0, 80) : [];

    if (logs.length === 0) {
      box.innerHTML = '<div class="log-line">Nenhum evento registrado ainda.</div>';
      return;
    }

    box.innerHTML = logs
      .map(function (entry) {
        var level = entry.level || entry.outcome || 'info';
        var cssClass =
          level === 'success' || entry.outcome === 'approved'
            ? 'log-success'
            : level === 'warn'
              ? 'log-warn'
              : level === 'error'
                ? 'log-error'
                : '';
        var time = String(entry.timestamp || '').slice(11, 19);
        return '<div class="log-line ' + cssClass + '">[' + escapeHtml(time) + '] ' + escapeHtml(entry.message) + '</div>';
      })
      .join('');
  }

  function renderAll() {
    renderTasks();
    renderTaskMeta();
    renderSteps();
    renderRecordingBanner();
    renderMetrics();
    renderLogs();
  }

  // ==========================================
  // ESTADO
  // ==========================================

  async function refresh() {
    var response = await sendMessage({ type: 'GET_STATE' });
    if (!response || !response.ok) return;

    state.tasks = Array.isArray(response.tasks) ? response.tasks : [];
    state.activeTask =
      state.tasks.find(function (task) { return task.id === response.activeTaskId; }) ||
      state.tasks[0] ||
      null;
    state.stats = response.stats || {};
    state.logs = Array.isArray(response.logs) ? response.logs : [];
    state.workflow = response.workflow || {};
    state.recording = response.recording || { active: false };
    state.background = response.background || null;

    renderAll();
  }

  async function saveActiveTask() {
    if (!state.activeTask) return { ok: false };
    renumber(state.activeTask.steps || []);
    var response = await sendMessage({ type: 'SAVE_TASK', task: state.activeTask });
    await refresh();
    return response;
  }

  function findStep(stepId) {
    if (!state.activeTask || !Array.isArray(state.activeTask.steps)) return null;
    return state.activeTask.steps.find(function (step) { return step.id === stepId; }) || null;
  }

  function stepIndex(stepId) {
    if (!state.activeTask || !Array.isArray(state.activeTask.steps)) return -1;
    return state.activeTask.steps.findIndex(function (step) { return step.id === stepId; });
  }

  function insertDelayAfter(stepId, seconds) {
    var task = state.activeTask;
    if (!task || !Array.isArray(task.steps)) return;

    var index = stepIndex(stepId);
    if (index < 0) return;

    var safeSeconds = Math.max(0.1, Number(seconds) || 2);
    var anchor = task.steps[index];

    task.steps.splice(index + 1, 0, {
      id: makeId('step-delay'),
      order: index + 2,
      label: 'Aguardar ' + safeSeconds + 's',
      action: 'sleep',
      cssSelector: '',
      ariaSelector: '',
      value: Math.round(safeSeconds * 1000),
      waitBeforeMs: 0,
      timeoutMs: Math.round(safeSeconds * 1000) + 1000,
      isLoopTarget: Boolean(anchor && anchor.isLoopTarget),
      url: '',
    });

    return saveActiveTask();
  }

  function syncScroll() {
    var container = $('log-list');
    if (container) container.scrollTop = 0;
  }

  // ==========================================
  // AÇÕES DOS PASSOS
  // ==========================================

  async function handleStepAction(action, stepId) {
    var task = state.activeTask;
    if (!task || !Array.isArray(task.steps)) return;

    if (action === 'toggle-menu') {
      state.openStepId = state.openStepId === stepId ? null : stepId;
      renderSteps();
      return;
    }

    if (action === 'delay-quick' || action === 'delay-1' || action === 'delay-2' || action === 'delay-5') {
      var preset = action === 'delay-quick' || action === 'delay-2' ? 2 : action === 'delay-1' ? 1 : 5;
      await insertDelayAfter(stepId, preset);
      return;
    }

    if (action === 'delay-custom') {
      var answer = window.prompt('Tempo de espera em segundos depois deste passo:', '2');
      if (answer == null) return;
      var seconds = Number(String(answer).replace(',', '.'));
      if (!Number.isFinite(seconds) || seconds <= 0) {
        window.alert('Informe um número de segundos maior que zero.');
        return;
      }
      await insertDelayAfter(stepId, seconds);
      return;
    }

    var step = findStep(stepId);
    if (!step) return;

    if (action === 'edit-wait') {
      var current = Math.round(((Number(step.waitBeforeMs) || 0) / 1000) * 10) / 10;
      var input = window.prompt('Espera ANTES deste passo, em segundos:', String(current));
      if (input == null) return;
      var value = Number(String(input).replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) {
        window.alert('Valor inválido.');
        return;
      }
      step.waitBeforeMs = Math.round(value * 1000);
      await saveActiveTask();
      return;
    }

    if (action === 'move-up' || action === 'move-down') {
      var index = stepIndex(stepId);
      var target = index + (action === 'move-up' ? -1 : 1);
      if (index < 0 || target < 0 || target >= task.steps.length) return;
      var moved = task.steps.splice(index, 1)[0];
      task.steps.splice(target, 0, moved);
      await saveActiveTask();
      return;
    }

    if (action === 'duplicate') {
      var originIndex = stepIndex(stepId);
      if (originIndex < 0) return;
      var clone = Object.assign({}, task.steps[originIndex], { id: makeId('step') });
      task.steps.splice(originIndex + 1, 0, clone);
      await saveActiveTask();
      return;
    }

    if (action === 'delete') {
      task.steps = task.steps.filter(function (item) { return item.id !== stepId; });
      if (state.openStepId === stepId) state.openStepId = null;
      await saveActiveTask();
      return;
    }

    if (action === 'run-from') {
      var startIndex = stepIndex(stepId);
      if (startIndex < 0) return;
      var response = await sendMessage({ type: 'START_BATCH_EXECUTION', startStepIdx: startIndex });
      if (response && response.ok === false) {
        window.alert(response.error || 'Não foi possível iniciar a execução.');
      }
      return;
    }
  }

  // ==========================================
  // EVENTOS
  // ==========================================

  function bindStaticEvents() {
    var stepsContainer = $('steps-list-container');
    if (stepsContainer) {
      stepsContainer.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-step-action]') : null;
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        handleStepAction(button.getAttribute('data-step-action'), button.getAttribute('data-step-id'));
      });
    }

    var select = $('select-active-task');
    if (select) {
      select.addEventListener('change', async function (event) {
        var taskId = event.target.value;
        if (!taskId) return;
        await sendMessage({ type: 'SET_ACTIVE_TASK', taskId: taskId });
        await refresh();
      });
    }

    var newTask = $('btn-new-task');
    if (newTask) {
      newTask.addEventListener('click', async function () {
        var name = window.prompt('Nome da nova automação (ex.: Preenchimento de relatório):');
        if (!name || !name.trim()) return;

        var task = {
          id: makeId('task-custom'),
          name: name.trim(),
          description: 'Automação criada pelo usuário.',
          category: 'Personalizado',
          pattern: 'free_macro',
          targetUrl: '',
          repeatMode: 'once',
          repeatCount: 1,
          steps: [],
        };

        await sendMessage({ type: 'SAVE_TASK', task: task });
        await refresh();
      });
    }

    document.querySelectorAll('.tab-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (other) {
          other.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(function (content) {
          content.classList.remove('active');
        });
        button.classList.add('active');
        var target = button.getAttribute('data-tab');
        var panel = target ? $(target) : null;
        if (panel) panel.classList.add('active');
      });
    });

    var start = $('btn-start');
    if (start) {
      start.addEventListener('click', async function () {
        var response = await sendMessage({ type: 'START_BATCH_EXECUTION' });
        if (response && response.ok === false) {
          window.alert(response.error || 'Falha ao iniciar.');
        }
        await refresh();
      });
    }

    var pause = $('btn-pause');
    if (pause) {
      pause.addEventListener('click', async function () {
        var isPaused = state.stats && state.stats.status === 'paused';
        await sendMessage({
          type: isPaused ? 'RESUME_BATCH_EXECUTION' : 'PAUSE_BATCH_EXECUTION',
        });
        await refresh();
      });
    }

    var stop = $('btn-stop');
    if (stop) {
      stop.addEventListener('click', async function () {
        await sendMessage({ type: 'STOP_BATCH_EXECUTION' });
        await refresh();
      });
    }

    var background = $('btn-background');
    if (background) {
      background.addEventListener('click', async function () {
        var task = state.activeTask;
        if (!task) {
          window.alert('Selecione uma automação.');
          return;
        }
        if (!Array.isArray(task.steps) || task.steps.length === 0) {
          window.alert('Grave pelo menos um passo antes de executar.');
          return;
        }

        var url = String(task.targetUrl || (state.workflow && state.workflow.targetUrl) || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          url = window.prompt('URL do portal para executar em segundo plano:', url || 'https://');
          if (!url) return;
        }

        var response = await sendMessage({
          type: 'START_BACKGROUND_EXECUTION',
          url: url.trim(),
          closeWhenDone: true,
        });

        if (!response || response.ok === false) {
          window.alert((response && response.error) || 'Não foi possível iniciar em segundo plano.');
          return;
        }

        await refresh();
      });
    }

    function triggerRecording(mode) {
      return sendMessage({
        type: 'START_RECORDING_WIZARD',
        mode: mode || 'free',
        taskId: state.activeTask ? state.activeTask.id : undefined,
      }).then(function (response) {
        if (response && response.ok === false) {
          window.alert(response.error || 'Não foi possível iniciar a gravação nesta aba.');
        }
        return refresh();
      });
    }

    ['btn-quick-record', 'btn-launch-free-record', 'btn-start-record-empty'].forEach(function (id) {
      var button = $(id);
      if (button) button.addEventListener('click', function () { triggerRecording('free'); });
    });

    var wizard = $('btn-launch-wizard-record');
    if (wizard) wizard.addEventListener('click', function () { triggerRecording('list_wizard'); });

    var bannerSave = $('btn-banner-save');
    if (bannerSave) {
      bannerSave.addEventListener('click', async function () {
        var recording = state.recording || {};
        if (!recording.active) return;
        await sendMessage({
          type: 'SAVE_RECORDED_STEPS',
          taskId: recording.taskId,
          steps: recording.recordedSteps || [],
          listConfig: recording.wizardListConfig || {},
        });
        await refresh();
      });
    }

    var bannerCancel = $('btn-banner-cancel');
    if (bannerCancel) {
      bannerCancel.addEventListener('click', async function () {
        if (!window.confirm('Cancelar a gravação? Os passos não salvos serão descartados.')) return;
        await sendMessage({ type: 'CANCEL_RECORDING_SESSION' });
        await refresh();
      });
    }

    var clear = $('btn-clear-steps');
    if (clear) {
      clear.addEventListener('click', async function () {
        if (!state.activeTask) return;
        if (!window.confirm('Apagar todos os passos desta automação?')) return;
        state.activeTask.steps = [];
        await saveActiveTask();
      });
    }

    document.querySelectorAll('input[name="repeatMode"]').forEach(function (radio) {
      radio.addEventListener('change', async function (event) {
        if (!state.activeTask) return;
        state.activeTask.repeatMode = event.target.value;
        if (event.target.value === 'repeat_n') {
          var count = $('input-repeat-count');
          state.activeTask.repeatCount = Number(count && count.value) || 10;
        }
        await saveActiveTask();
      });
    });

    var repeatCount = $('input-repeat-count');
    if (repeatCount) {
      repeatCount.addEventListener('change', async function (event) {
        if (!state.activeTask) return;
        state.activeTask.repeatCount = Math.max(1, Number(event.target.value) || 1);
        await saveActiveTask();
      });
    }

    document.querySelectorAll('.speed-btn').forEach(function (button) {
      button.addEventListener('click', async function () {
        document.querySelectorAll('.speed-btn').forEach(function (other) {
          other.classList.remove('active');
        });
        button.classList.add('active');

        var speed = button.getAttribute('data-speed');
        var workflow = Object.assign({}, state.workflow);

        if (speed === 'adaptive') {
          workflow.baseDelayMs = 500;
          workflow.randomJitterMs = 250;
        } else if (speed === 'human') {
          workflow.baseDelayMs = 900;
          workflow.randomJitterMs = 400;
        } else {
          workflow.baseDelayMs = 250;
          workflow.randomJitterMs = 120;
        }
        workflow.speedMode = speed;
        workflow.autoWaitEnabled = true;

        try {
          var stored = await chrome.storage.local.get('rpaWorkflow');
          await chrome.storage.local.set({ rpaWorkflow: Object.assign({}, stored.rpaWorkflow || {}, workflow) });
        } catch (err) {
          /* ignore */
        }
        state.workflow = workflow;
      });
    });

    var exportCsv = $('btn-export-csv');
    if (exportCsv) {
      exportCsv.addEventListener('click', function () {
        var logs = Array.isArray(state.logs) ? state.logs : [];
        var header = 'timestamp,level,outcome,message';
        var rows = logs.map(function (entry) {
          return [
            '"' + String(entry.timestamp || '').replace(/"/g, '""') + '"',
            '"' + String(entry.level || '').replace(/"/g, '""') + '"',
            '"' + String(entry.outcome || '').replace(/"/g, '""') + '"',
            '"' + String(entry.message || '').replace(/"/g, '""') + '"',
          ].join(',');
        });

        var blob = new Blob([[header].concat(rows).join('\n')], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'auditoria_autoapprove.csv';
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      });
    }
  }

  function watchStorage() {
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        refresh();
      });
    } catch (err) {
      /* storage.change indisponível */
    }
  }

  function renderVersion() {
    var badge = $('ext-version');
    if (!badge) return;
    try {
      var manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
      badge.textContent = 'v' + ((manifest && manifest.version) || '?');
    } catch (err) {
      badge.textContent = 'v?';
    }
  }

  bindStaticEvents();
  watchStorage();
  renderVersion();
  refresh();
  syncScroll();

  // Atualiza o painel enquanto ele fica aberto (gravação em tempo real)
  setInterval(function () {
    if (document.hidden) return;
    refresh();
  }, 2500);
})();
