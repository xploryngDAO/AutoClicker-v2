// AutoApprove RPA — popup da barra de ferramentas
(function () {
  'use strict';

  function setStatus(text) {
    var line = document.getElementById('status-line');
    if (line) line.textContent = text;
  }

  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          void chrome.runtime.lastError;
          resolve(response || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  async function openPanel() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0];

    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && tab && tab.windowId) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        window.close();
        return;
      } catch (err) {
        // Chrome < 116 ou janela sem suporte: cai no modo aba
      }
    }

    // Fallback: abre o painel em uma aba normal (também serve como "modal")
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
      window.close();
    } catch (err) {
      setStatus('Não foi possível abrir o painel: ' + String(err));
    }
  }

  var openButton = document.getElementById('btn-open-panel');
  if (openButton) {
    openButton.addEventListener('click', function () {
      openPanel();
    });
  }

  var runButton = document.getElementById('btn-quick-run');
  if (runButton) {
    runButton.addEventListener('click', async function () {
      setStatus('Iniciando execução...');
      var response = await send({ type: 'START_BATCH_EXECUTION' });
      if (response && response.ok === false) {
        setStatus(response.error || 'Falha ao iniciar.');
        return;
      }
      setStatus('Execução iniciada.');
      setTimeout(function () { window.close(); }, 600);
    });
  }

  var recordButton = document.getElementById('btn-quick-record');
  if (recordButton) {
    recordButton.addEventListener('click', async function () {
      setStatus('Abrindo gravador...');
      var response = await send({ type: 'START_RECORDING_WIZARD', mode: 'free' });
      if (response && response.ok === false) {
        setStatus(response.error || 'Falha ao gravar nesta aba.');
        return;
      }
      setStatus('Gravador ativo na página.');
      setTimeout(function () { window.close(); }, 600);
    });
  }

  send({ type: 'GET_STATE' }).then(function (response) {
    if (!response || !response.ok) {
      setStatus('Serviço de fundo ainda inicializando...');
      return;
    }
    var count = Array.isArray(response.tasks) ? response.tasks.length : 0;
    var steps = 0;
    var tasks = response.tasks || [];
    var active = tasks.find(function (task) { return task.id === response.activeTaskId; });
    if (active && Array.isArray(active.steps)) steps = active.steps.length;
    setStatus(count + ' automação(ões) · ' + steps + ' passo(s) na ativa');
  });
})();
