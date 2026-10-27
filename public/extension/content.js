// AutoApprove RPA — Motor Universal de Automação & Gravação Livre
// Sistema de Execução com Espera Inteligente de Carregamento & Gravação Persistente
(() => {
  let isExecuting = false;
  let activeRecordingMode = null; // 'free' | 'list_wizard' | null
  let currentRecordingTaskId = null;
  let recordedSteps = [];
  let wizardPhase = null; // 'list_row' | 'detail_steps' | 'return_action' | 'next_page'
  let wizardListConfig = {};
  let isPaused = false;
  let hudMinimized = false;
  let waitingForElementMode = false;
  let lastNavigatedNotice = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================
  // MOTOR DE ESPERA INTELIGENTE & ESTABILIZAÇÃO
  // ==========================================

  // Verifica se um elemento está visível, renderizado e habilitado para interação
  function isElementActionable(el) {
    if (!el || !document.body.contains(el)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    if (el.classList.contains('disabled') || el.classList.contains('is-loading')) {
      return false;
    }
    return true;
  }

  // Aguarda que bloqueadores de tela, spinners, loaders e barras de progresso sumam
  async function waitForBlockersToVanish(timeoutMs = 12000) {
    const start = Date.now();
    const blockerSelectors = [
      '[aria-busy="true"]',
      '.spinner:not(.hidden)',
      '.loading-spinner:not(.hidden)',
      '.loader:not(.hidden)',
      '[data-loading="true"]',
      '.overlay-loading',
      '.modal-backdrop.fade:not(.show)',
      '.sk-spinner',
      'div[role="progressbar"]',
      '.ant-spin',
      '.v-progress-circular',
      '.mat-progress-spinner',
    ].join(', ');

    while (Date.now() - start < timeoutMs) {
      try {
        const blockers = Array.from(document.querySelectorAll(blockerSelectors)).filter(
          (b) =>
            isElementActionable(b) &&
            !b.closest('#autoapprove-hud') &&
            !b.closest('#autoapprove-exec-hud')
        );
        if (blockers.length === 0) return true;
      } catch {
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  // Monitora mutações no DOM e aguarda até que a página pare de se redesenhar (quietude)
  function waitForDomMutationQuiet(quietMs = 350, maxWaitMs = 6000) {
    return new Promise((resolve) => {
      let timer = null;
      let observer = null;
      const startTime = Date.now();

      function done() {
        if (timer) clearTimeout(timer);
        if (observer) observer.disconnect();
        resolve();
      }

      const maxTimer = setTimeout(done, maxWaitMs);

      function resetTimer() {
        if (timer) clearTimeout(timer);
        if (Date.now() - startTime >= maxWaitMs) {
          done();
          return;
        }
        timer = setTimeout(() => {
          clearTimeout(maxTimer);
          done();
        }, quietMs);
      }

      try {
        observer = new MutationObserver(() => {
          resetTimer();
        });
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        resetTimer();
      } catch {
        setTimeout(done, quietMs);
      }
    });
  }

  // Estabilização Completa Pós-Ação: Aguarda carregamentos de rede, transições e DOM
  async function waitForActionSettled(baseExtraMs = 450) {
    // 1. Respiro inicial para que o navegador processe o clique e dispare requisições
    await sleep(baseExtraMs);

    // 2. Aguarda document.readyState se a página estiver navegando
    if (document.readyState === 'loading') {
      await new Promise((r) => {
        document.addEventListener('DOMContentLoaded', r, { once: true });
        setTimeout(r, 4000);
      });
    }

    // 3. Aguarda desaparecimento de loaders e spinners
    await waitForBlockersToVanish(10000);

    // 4. Aguarda estabilização de mutações no DOM (término de re-renders)
    await waitForDomMutationQuiet(300, 5000);
  }

  // Localiza o elemento interativo de um passo com múltiplas estratégias resilientes
  async function findActionableElement(step, timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (!isExecuting) throw new Error('Execução cancelada pelo usuário.');

      // Aguarda desobstrução se houver algum spinner ativo
      await waitForBlockersToVanish(1000);

      // 1. Tenta Seletor CSS Principal
      if (step.cssSelector) {
        try {
          const candidate = document.querySelector(step.cssSelector);
          if (candidate && isElementActionable(candidate)) {
            return candidate;
          }
        } catch {}
      }

      // 2. Tenta XPath se gravado
      if (step.xpath) {
        try {
          const result = document.evaluate(step.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (result.singleNodeValue && isElementActionable(result.singleNodeValue)) {
            return result.singleNodeValue;
          }
        } catch {}
      }

      // 3. Tenta Seletor Semântico por Texto ou Rótulo
      if (step.label) {
        const cleanText = step.label
          .replace(/^Clicar em |^Preencher campo |^Marcar opção |^Selecionar em |^Aguardar elemento /i, '')
          .replace(/["']/g, '')
          .trim();

        if (cleanText.length >= 2) {
          const candidates = Array.from(
            document.querySelectorAll('button, a, input, select, tr, [role="button"], label, td')
          );
          const match = candidates.find((c) => {
            if (!isElementActionable(c)) return false;
            const text = (
              c.innerText ||
              c.getAttribute('aria-label') ||
              c.getAttribute('placeholder') ||
              c.getAttribute('title') ||
              c.id ||
              ''
            ).trim();
            return text.toLowerCase().includes(cleanText.toLowerCase());
          });
          if (match) return match;
        }
      }

      await sleep(200);
    }

    throw new Error(
      `Tempo limite (${Math.round(timeoutMs / 1000)}s) aguardando carregamento do elemento: ${step.label} [${step.cssSelector}]`
    );
  }

  // Realiza um clique com disparos de eventos de ponteiro realistas
  async function performClick(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    highlightElement(el, '#2563eb');
    await sleep(180);

    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.focus();
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
  }

  // ==========================================
  // SELETORES RESILIENTES PARA GRAVAÇÃO
  // ==========================================

  function getResilientSelector(el) {
    if (!el || el.nodeType !== 1) return 'body';

    // 1. Atributos Semânticos de Automação & Teste
    if (el.dataset && el.dataset.action) return `${el.tagName.toLowerCase()}[data-action="${el.dataset.action}"]`;
    if (el.dataset && el.dataset.testid) return `${el.tagName.toLowerCase()}[data-testid="${el.dataset.testid}"]`;
    if (el.dataset && el.dataset.qa) return `${el.tagName.toLowerCase()}[data-qa="${el.dataset.qa}"]`;
    if (el.dataset && el.dataset.cy) return `${el.tagName.toLowerCase()}[data-cy="${el.dataset.cy}"]`;

    // 2. ID Estável (Ignora IDs dinâmicos gerados por frameworks)
    if (el.id && !/\d{4,}/.test(el.id) && !/^(:r|react|ng|ember|vue|_)/i.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }

    // 3. Atributos Acessíveis & Nomes de Formulário
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
    }
    const name = el.getAttribute('name');
    if (name) {
      return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) {
      return `${el.tagName.toLowerCase()}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;
    }
    const title = el.getAttribute('title');
    if (title) {
      return `${el.tagName.toLowerCase()}[title="${title.replace(/"/g, '\\"')}"]`;
    }

    // 4. Botão ou Link com Classe Estável
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
      if (el.className && typeof el.className === 'string') {
        const firstClass = el.className
          .split(/\s+/)
          .filter((c) => c && !c.includes(':') && !c.startsWith('hover'))
          .slice(0, 2)
          .join('.');
        if (firstClass) {
          const candidate = `${el.tagName.toLowerCase()}.${firstClass}`;
          if (document.querySelectorAll(candidate).length === 1) return candidate;
        }
      }
    }

    // 5. Hierarquia Estrutural
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    return `${getResilientSelector(parent)} > ${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && !/\d{4,}/.test(el.id)) return `//*[@id="${el.id}"]`;
    const text = (el.innerText || '').trim();
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && text && text.length < 30) {
      return `//${el.tagName.toLowerCase()}[contains(text(), '${text.replace(/'/g, "\\'")}')]`;
    }
    if (el === document.body) return '/html/body';
    let ix = 0;
    const siblings = el.parentNode ? el.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === el) {
        return `${getXPath(el.parentNode)}/${el.tagName.toLowerCase()}[${ix + 1}]`;
      }
      if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
        ix++;
      }
    }
    return '';
  }

  function getAriaSelector(el) {
    if (!el) return '';
    const role =
      el.getAttribute('role') ||
      (el.tagName === 'BUTTON'
        ? 'button'
        : el.tagName === 'A'
        ? 'link'
        : el.type === 'checkbox'
        ? 'checkbox'
        : el.tagName === 'INPUT'
        ? 'textbox'
        : el.tagName.toLowerCase());
    const name =
      el.getAttribute('aria-label') ||
      (el.innerText || '').trim().slice(0, 30) ||
      el.getAttribute('name') ||
      el.id ||
      '';
    if (name) {
      return `role=${role}[name="${name.replace(/"/g, '\\"')}"]`;
    }
    return `role=${role}`;
  }

  function getCleanLabel(el, actionType) {
    const text = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.id ||
      ''
    ).trim();

    const shortText = text ? `"${text.slice(0, 28)}"` : el.tagName.toLowerCase();

    if (actionType === 'fill') return `Preencher campo ${shortText}`;
    if (actionType === 'check') return `Marcar opção ${shortText}`;
    if (actionType === 'select') return `Selecionar em ${shortText}`;
    if (actionType === 'navigate') return `Navegar para página ${shortText}`;
    if (actionType === 'wait_visible') return `Aguardar elemento ${shortText} ficar visível`;
    return `Clicar em ${shortText}`;
  }

  function highlightElement(el, color = '#10b981') {
    if (!el) return;
    const prevOutline = el.style.outline;
    const prevTransition = el.style.transition;
    const prevShadow = el.style.boxShadow;
    el.style.transition = 'all 0.2s ease-in-out';
    el.style.outline = `3px solid ${color}`;
    el.style.boxShadow = `0 0 15px ${color}`;
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.boxShadow = prevShadow;
      el.style.transition = prevTransition;
    }, 600);
  }

  function sendLog(level, message, outcome) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_STATS',
      logEntry: {
        timestamp: new Date().toISOString(),
        level,
        message,
        outcome,
      },
    }).catch(() => {});
  }

  // ==========================================
  // PAINEL FLUTUANTE DE EXECUÇÃO EM TEMPO REAL
  // ==========================================

  function renderExecutionHUD(info) {
    let execHud = document.getElementById('autoapprove-exec-hud');
    if (!info) {
      if (execHud) execHud.remove();
      return;
    }

    if (!execHud) {
      execHud = document.createElement('div');
      execHud.id = 'autoapprove-exec-hud';
      execHud.style.cssText = [
        'position: fixed',
        'top: 18px',
        'right: 24px',
        'z-index: 2147483647',
        'background: rgba(15, 23, 42, 0.95)',
        'color: #f8fafc',
        'border: 2px solid #10b981',
        'border-radius: 12px',
        'padding: 10px 14px',
        'box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7), 0 0 20px rgba(16, 185, 129, 0.25)',
        'display: flex',
        'align-items: center',
        'gap: 12px',
        'font-family: system-ui, -apple-system, sans-serif',
        'font-size: 12px',
        'backdrop-filter: blur(12px)',
        'user-select: none',
      ].join(';');
      document.body.appendChild(execHud);
    }

    execHud.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981; animation: recPulse 1.5s infinite;"></span>
        <div>
          <strong style="color: #fff; font-size: 12px; display: block;">${info.taskName || 'Robô em Execução'}</strong>
          <span style="color: #94a3b8; font-size: 11px;">Passo ${info.stepIndex}/${info.totalSteps}: ${info.label}</span>
          ${info.waitingSettle ? '<span style="color: #38bdf8; font-weight: bold; display: block; font-size: 10px;">⏳ Aguardando carregamento e estabilização da ação...</span>' : ''}
        </div>
      </div>
      <button id="exec-hud-btn-abort" style="padding: 5px 10px; background: #ef4444; color: #fff; border: none; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">
        ✕ Parar
      </button>
    `;

    document.getElementById('exec-hud-btn-abort')?.addEventListener('click', () => {
      isExecuting = false;
      renderExecutionHUD(null);
      sendLog('warn', 'Execução interrompida pelo usuário no painel da página.');
    });
  }

  // ==========================================
  // EXECUÇÃO COM ESPERA DINÂMICA
  // ==========================================

  // Execução de Macro Universal com Espera Dinâmica de Carregamento
  async function executeFreeMacroTask(task, config, startFromStepIdx = 0, currentCycle = 1) {
    isExecuting = true;
    const baseDelayMs = config.baseDelayMs || 500;
    const randomJitterMs = config.randomJitterMs || 250;
    const repeatCount = task.repeatMode === 'repeat_n' ? task.repeatCount || 1 : 1;
    const steps = task.steps || [];

    sendLog('info', `Iniciando execução de "${task.name}" com Espera Inteligente de Carregamento (Ciclo ${currentCycle}/${repeatCount})...`);

    try {
      for (let cycle = currentCycle; cycle <= repeatCount; cycle++) {
        if (!isExecuting) break;

        const sStart = cycle === currentCycle ? startFromStepIdx : 0;

        for (let sIdx = sStart; sIdx < steps.length; sIdx++) {
          if (!isExecuting) break;
          const step = steps[sIdx];

          // Salva estado de execução para o caso de navegação de página ocorrer no clique
          chrome.storage.local.set({
            rpaExecutionSession: {
              active: true,
              taskId: task.id,
              cycle,
              repeatCount,
              nextStepIdx: sIdx + 1,
              config,
            },
          }).catch(() => {});

          renderExecutionHUD({
            taskName: task.name,
            stepIndex: sIdx + 1,
            totalSteps: steps.length,
            label: step.label,
            waitingSettle: false,
          });

          // Pausa humana configurável antes do passo
          await sleep(Math.max(200, step.waitBeforeMs) + Math.floor(Math.random() * randomJitterMs));

          try {
            if (step.action === 'sleep') {
              const ms = Number(step.value) || 2000;
              sendLog('info', `Aguardando ${ms / 1000}s conforme programado...`);
              await sleep(ms);
              continue;
            }

            if (step.action === 'navigate' && step.value) {
              if (window.location.href !== step.value) {
                sendLog('info', `Navegando para: ${step.value}...`);
                window.location.href = step.value;
                return; // Aguarda novo carregamento da página
              }
              continue;
            }

            // Localiza elemento garantindo que ele está carregado, renderizado e interativo
            const el = await findActionableElement(step, step.timeoutMs || 15000);

            if (step.action === 'fill') {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              highlightElement(el, '#10b981');
              el.focus();
              el.value = step.value || '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            } else if (step.action === 'check') {
              if (!el.checked) {
                await performClick(el);
              }
            } else if (step.action === 'select') {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              highlightElement(el, '#10b981');
              el.value = step.value || '';
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (step.action === 'wait_visible') {
              // Já validado pelo findActionableElement
              highlightElement(el, '#facc15');
            } else {
              // CLIQUE: Executa e em seguida aguarda carregamento
              await performClick(el);
            }

            sendLog('info', `Passo ${sIdx + 1}/${steps.length} concluído: ${step.label}`);

            // AQUI ESTÁ A CORREÇÃO CRUCIAL:
            // Atualiza HUD informando que está aguardando a resposta da ação
            renderExecutionHUD({
              taskName: task.name,
              stepIndex: sIdx + 1,
              totalSteps: steps.length,
              label: step.label,
              waitingSettle: true,
            });

            // Aguarda que eventuais spinners fechem, requisições AJAX terminem e o DOM se estabilize!
            await waitForActionSettled(baseDelayMs);
          } catch (stepErr) {
            sendLog('warn', `Aviso no passo ${sIdx + 1} (${step.label}): ${String(stepErr.message)}`);
            // Dá um tempo extra de recuperação antes de desistir
            await sleep(1000);
          }
        }

        chrome.runtime.sendMessage({
          type: 'UPDATE_STATS',
          patch: { approved: cycle },
        }).catch(() => {});
      }

      // Conclusão bem-sucedida: limpa sessão de execução
      await chrome.storage.local.set({
        rpaExecutionSession: { active: false },
      });

      sendLog('success', `Tarefa "${task.name}" executada com sucesso com espera adaptativa (${repeatCount} ciclos)!`);
    } finally {
      isExecuting = false;
      renderExecutionHUD(null);
      chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        patch: { status: 'idle' },
      }).catch(() => {});
    }
  }

  // Execução de Tabela em Lote com Espera Adaptativa
  async function executeBatchTableWorkflow(task, config) {
    isExecuting = true;
    const baseDelayMs = config.baseDelayMs || 500;
    const randomJitterMs = config.randomJitterMs || 250;
    const maxRetries = config.maxRetries || 3;
    const listConfig = task.listConfig || {};
    const listRowSelector = listConfig.listRowSelector || 'tr.linha-solicitacao-pendente, tr[data-status="pending"]';
    const openDetailSelector = listConfig.openDetailSelector || 'button[data-action="abrir-detalhe"], .btn-primary, td:last-child button';
    const returnMode = listConfig.returnMode || 'auto';
    const returnSelector = listConfig.returnSelector;
    const paginationEnabled = listConfig.paginationEnabled !== false;
    const nextPageSelector = listConfig.nextPageSelector || 'button#btn-proxima-pagina, a.pagination-next';
    const waitAfterPageTurnMs = listConfig.waitAfterPageTurnMs || 1500;

    const detailSteps = task.steps || [];
    let approvedTotal = 0;
    let failedTotal = 0;
    let currentPage = 1;

    sendLog('info', `Iniciando aprovações em tabela com Espera Adaptativa: "${task.name}"...`);

    try {
      while (isExecuting) {
        // Aguarda estabilização inicial da tabela
        await waitForActionSettled(400);

        const rows = Array.from(document.querySelectorAll(listRowSelector)).filter(
          (r) => r.offsetParent !== null && !r.classList.contains('approved')
        );

        if (rows.length === 0) {
          if (paginationEnabled && nextPageSelector) {
            const nextBtn = document.querySelector(nextPageSelector);
            if (nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null) {
              sendLog('info', `Avançando para a página ${currentPage + 1}...`);
              await performClick(nextBtn);
              currentPage += 1;
              chrome.runtime.sendMessage({
                type: 'UPDATE_STATS',
                patch: { currentPage, approved: approvedTotal, failed: failedTotal },
              }).catch(() => {});
              await waitForActionSettled(waitAfterPageTurnMs);
              continue;
            }
          }
          sendLog('success', `Processamento finalizado! Total de ${approvedTotal} aprovações.`);
          break;
        }

        for (let i = 0; i < rows.length; i++) {
          if (!isExecuting) break;
          const row = rows[i];
          const itemId = row.getAttribute('data-id') || row.querySelector('strong, .protocolo-id')?.innerText || `Item #${i + 1}`;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              row.scrollIntoView({ block: 'center', behavior: 'smooth' });
              highlightElement(row);
              await sleep(baseDelayMs + Math.floor(Math.random() * randomJitterMs));

              const openBtn = (openDetailSelector ? row.querySelector(openDetailSelector) : null) || row.querySelector('button, a') || row;
              await performClick(openBtn);

              // Aguarda o modal ou subpágina carregar completamente antes de tocar nos campos!
              await waitForActionSettled(500);

              for (const step of detailSteps) {
                if (!isExecuting) return;

                renderExecutionHUD({
                  taskName: task.name,
                  stepIndex: step.order || 1,
                  totalSteps: detailSteps.length,
                  label: step.label,
                  waitingSettle: false,
                });

                await sleep(step.waitBeforeMs + Math.floor(Math.random() * randomJitterMs));
                const el = await findActionableElement(step, step.timeoutMs || 10000);

                if (step.action === 'check') {
                  if (!el.checked) await performClick(el);
                } else if (step.action === 'select' && step.value) {
                  el.scrollIntoView({ block: 'center', behavior: 'instant' });
                  highlightElement(el);
                  el.value = step.value;
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (step.action === 'fill' && step.value) {
                  el.scrollIntoView({ block: 'center', behavior: 'instant' });
                  highlightElement(el);
                  el.value = step.value;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  await performClick(el);
                }

                // Aguarda cada passo de detalhe carregar/estabilizar
                await waitForActionSettled(baseDelayMs);
              }

              // Retorno para a lista
              await sleep(350);
              if (returnMode === 'history_back') {
                window.history.back();
              } else if (returnSelector && document.querySelector(returnSelector)) {
                const backBtn = document.querySelector(returnSelector);
                if (backBtn && backBtn.offsetParent !== null) await performClick(backBtn);
              } else {
                const fallbackBack = document.querySelector(
                  'button#btn-cancelar-aprovacao, button.btn-voltar, .modal-backdrop button, [data-action="close-modal"]'
                );
                if (fallbackBack && fallbackBack.offsetParent !== null) await performClick(fallbackBack);
              }

              // Aguarda o fechamento do modal e restauração da grade
              await waitForActionSettled(500);

              approvedTotal += 1;
              sendLog('success', `${itemId} aprovado com sucesso! (${approvedTotal})`, 'approved');
              chrome.runtime.sendMessage({
                type: 'UPDATE_STATS',
                patch: { approved: approvedTotal, currentPage },
              }).catch(() => {});
              break;
            } catch (err) {
              if (attempt === maxRetries) {
                failedTotal += 1;
                sendLog('error', `Falha no ${itemId}: ${String(err.message)}`, 'failed');
              } else {
                await sleep(600 * attempt);
              }
            }
          }
        }
      }
    } finally {
      isExecuting = false;
      renderExecutionHUD(null);
      chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        patch: { status: 'idle' },
      }).catch(() => {});
    }
  }

  // ==========================================
  // GRAVAÇÃO PERSISTENTE (HUD & REIDRATAÇÃO)
  // ==========================================

  function persistSessionState() {
    const session = {
      active: Boolean(activeRecordingMode),
      mode: activeRecordingMode,
      taskId: currentRecordingTaskId,
      status: isPaused ? 'paused' : 'recording',
      recordedSteps: recordedSteps,
      wizardPhase: wizardPhase,
      wizardListConfig: wizardListConfig,
      lastUrl: window.location.href,
      lastPageTitle: document.title,
      hudMinimized: hudMinimized,
      updatedAt: new Date().toISOString(),
    };

    chrome.storage.local.set({ rpaRecordingSession: session }).catch(() => {});
    chrome.runtime.sendMessage({
      type: 'SYNC_RECORDING_STEP',
      stepCount: recordedSteps.length,
      session,
    }).catch(() => {});
  }

  function addRecordedStep(step) {
    recordedSteps.push(step);
    persistSessionState();
    sendLog('info', `[Passo ${step.order}] Gravado: ${step.label}`);
    renderHUD();
  }

  function renderHUD(options = {}) {
    if (!activeRecordingMode) {
      const existing = document.getElementById('autoapprove-hud');
      if (existing) existing.remove();
      return;
    }

    let hud = document.getElementById('autoapprove-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'autoapprove-hud';
      hud.style.cssText = [
        'position: fixed',
        'bottom: 24px',
        'right: 24px',
        'z-index: 2147483647',
        'background: rgba(10, 15, 29, 0.96)',
        'color: #f8fafc',
        'border: 2px solid #3b82f6',
        'border-radius: 16px',
        'padding: 12px 16px',
        'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 20px rgba(59, 130, 246, 0.3)',
        'display: flex',
        'flex-direction: column',
        'gap: 10px',
        'font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-size: 12px',
        'width: 520px',
        'max-width: 95vw',
        'backdrop-filter: blur(16px)',
        'transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'user-select: none',
      ].join(';');
      document.body.appendChild(hud);
      setupDraggable(hud);
    }

    const isFree = activeRecordingMode === 'free';
    const stepCount = recordedSteps.length;

    if (hudMinimized) {
      hud.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${isPaused ? '#eab308' : '#ef4444'}; box-shadow: 0 0 10px ${isPaused ? '#eab308' : '#ef4444'};"></span>
            <strong style="color: #fff; font-size: 12px;">${isPaused ? 'Gravação Pausada' : 'Gravando na Tela'}</strong>
            <span style="background: #1e293b; color: #38bdf8; padding: 2px 8px; border-radius: 999px; font-weight: bold; font-size: 11px;">
              ${stepCount} passo${stepCount === 1 ? '' : 's'}
            </span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button id="hud-btn-expand" style="padding: 4px 10px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">
              ▲ Expandir Painel
            </button>
            <button id="hud-btn-quick-save" style="padding: 4px 10px; background: #16a34a; color: #fff; border: none; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">
              💾 Salvar
            </button>
          </div>
        </div>
      `;
      document.getElementById('hud-btn-expand')?.addEventListener('click', () => {
        hudMinimized = false;
        persistSessionState();
        renderHUD();
      });
      document.getElementById('hud-btn-quick-save')?.addEventListener('click', finishRecording);
      return;
    }

    let phaseInstruction = '';
    if (waitingForElementMode) {
      phaseInstruction = '<span style="color: #facc15; font-weight: bold;">👁️ MODO ESPERA: Clique no elemento para que o robô aguarde seu carregamento.</span>';
    } else if (isPaused) {
      phaseInstruction = '<span style="color: #facc15;">⏸️ <strong>Gravação Pausada:</strong> Clicks na página não estão sendo gravados.</span>';
    } else if (isFree) {
      phaseInstruction = '<strong>Modo Livre Universal Ativo:</strong> Clique em qualquer botão ou campo. O robô memoriza a ordem e o novo motor aguarda o carregamento de cada tela na execução.';
    } else {
      if (wizardPhase === 'list_row') phaseInstruction = '<strong>Fase 1:</strong> Clique no botão de abrir um item na tabela.';
      else if (wizardPhase === 'detail_steps') phaseInstruction = '<strong>Fase 2:</strong> Realize as ações dentro da tela de detalhes (checkboxes, aprovação).';
      else if (wizardPhase === 'return_action') phaseInstruction = '<strong>Fase 3:</strong> Clique no botão "Voltar" ou use o histórico.';
      else phaseInstruction = '<strong>Fase 4:</strong> Clique no botão "Próxima Página" da paginação.';
    }

    let navNoticeHtml = '';
    if (options.justNavigated || lastNavigatedNotice) {
      navNoticeHtml = `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; padding: 6px 10px; font-size: 11px; color: #34d399; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span>🌐 <strong>Página Recarregada / Nova URL:</strong> Gravação continuada sem interrupções! (${stepCount} passos preservados)</span>
          <button id="hud-btn-dismiss-nav" style="background: transparent; border: none; color: #6ee7b7; cursor: pointer; font-size: 12px;">✕</button>
        </div>
      `;
    }

    let stepsListHtml = '';
    if (stepCount > 0) {
      stepsListHtml = `
        <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 6px 10px; max-height: 110px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;">
          ${recordedSteps
            .map(
              (s, i) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #0f172a; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="color: #64748b;">${i + 1}.</span>
                <span style="color: ${s.action === 'click' ? '#60a5fa' : s.action === 'fill' ? '#34d399' : s.action === 'navigate' ? '#c084fc' : '#f59e0b'}; font-weight: bold;">
                  [${s.action.toUpperCase()}]
                </span>
                <span style="color: #e2e8f0;">${s.label}</span>
                ${s.value ? `<span style="color: #94a3b8;">("${s.value}")</span>` : ''}
              </div>
              <button class="hud-del-step" data-idx="${i}" style="background: transparent; border: none; color: #64748b; cursor: pointer; padding: 0 4px; font-size: 12px;" title="Remover este passo">✕</button>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    hud.innerHTML = `
      <div id="hud-drag-handle" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; cursor: move;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${isPaused ? '#eab308' : '#ef4444'}; box-shadow: 0 0 10px ${isPaused ? '#eab308' : '#ef4444'};"></span>
          <strong style="font-size: 13px; color: #fff;">
            ${isPaused ? 'Gravação em Pausa' : 'Robô Gravando em Tempo Real'}
          </strong>
          <span style="background: #1e293b; color: #38bdf8; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;">
            ${stepCount} passo${stepCount === 1 ? '' : 's'}
          </span>
          <span style="background: #064e3b; color: #6ee7b7; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;" title="Espera Inteligente de Carregamento Ativa">
            ⚡ Auto-Wait Ativo
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button id="hud-btn-minimize" style="background: transparent; border: 1px solid #334155; color: #cbd5e1; border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer;" title="Minimizar">_</button>
        </div>
      </div>

      ${navNoticeHtml}

      <div style="color: #cbd5e1; font-size: 11.5px; line-height: 1.4;">
        ${phaseInstruction}
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 5px;">
        <button id="hud-btn-toggle-pause" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; background: ${isPaused ? '#ca8a04' : '#1e293b'}; color: #fff; font-size: 10.5px; font-weight: bold; cursor: pointer;">
          ${isPaused ? '▶️ Retomar Gravação' : '⏸️ Pausar'}
        </button>
        <button id="hud-btn-add-delay" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #93c5fd; font-size: 10.5px; cursor: pointer;" title="Inserir pausa no fluxo">
          ⏱️ + Espera (2s)
        </button>
        <button id="hud-btn-add-nav" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #c084fc; font-size: 10.5px; cursor: pointer;" title="Registrar URL atual como navegação">
          🌐 + Gravar URL Atual
        </button>
        <button id="hud-btn-wait-el" style="padding: 4px 8px; border-radius: 6px; border: 1px solid ${waitingForElementMode ? '#eab308' : '#334155'}; background: ${waitingForElementMode ? '#713f12' : '#1e293b'}; color: #fde047; font-size: 10.5px; cursor: pointer;" title="Clique em um elemento para aguardar que ele apareça">
          👁️ + Esperar Elemento
        </button>
      </div>

      ${stepsListHtml}

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px;">
        <div style="display: flex; gap: 6px;">
          ${stepCount > 0 ? `
            <button id="hud-btn-undo" style="padding: 6px 10px; background: #334155; color: #e2e8f0; border: none; border-radius: 8px; font-size: 11px; font-weight: bold; cursor: pointer;">
              ⎌ Desfazer Último
            </button>
          ` : ''}
          ${!isFree && wizardPhase === 'return_action' ? `
            <button id="hud-btn-use-history-back" style="padding: 6px 10px; background: #4338ca; color: #fff; border: none; border-radius: 8px; font-size: 11px; font-weight: bold; cursor: pointer;">
              Usar history.back()
            </button>
          ` : ''}
        </div>
        <div style="display: flex; gap: 6px;">
          <button id="hud-btn-finish" style="padding: 6px 14px; background: #16a34a; color: #fff; border: none; border-radius: 8px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 0 10px rgba(22, 163, 74, 0.4);">
            💾 Salvar Gravação & Concluir
          </button>
          <button id="hud-btn-close" style="padding: 6px 10px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 8px; font-size: 11px; cursor: pointer;">
            ✕ Cancelar
          </button>
        </div>
      </div>
    `;

    document.getElementById('hud-btn-minimize')?.addEventListener('click', () => {
      hudMinimized = true;
      persistSessionState();
      renderHUD();
    });

    document.getElementById('hud-btn-dismiss-nav')?.addEventListener('click', () => {
      lastNavigatedNotice = null;
      renderHUD();
    });

    document.getElementById('hud-btn-toggle-pause')?.addEventListener('click', () => {
      isPaused = !isPaused;
      persistSessionState();
      renderHUD();
      sendLog('info', isPaused ? 'Gravação pausada pelo usuário.' : 'Gravação retomada.');
    });

    document.getElementById('hud-btn-add-delay')?.addEventListener('click', () => {
      const step = {
        id: 'step-' + Date.now(),
        order: recordedSteps.length + 1,
        label: 'Aguardar 2 segundos para estabilização da página',
        action: 'sleep',
        cssSelector: 'body',
        ariaSelector: 'body',
        value: '2000',
        waitBeforeMs: 2000,
        timeoutMs: 5000,
        isLoopTarget: false,
        url: window.location.href,
      };
      addRecordedStep(step);
    });

    document.getElementById('hud-btn-add-nav')?.addEventListener('click', () => {
      const step = {
        id: 'step-' + Date.now(),
        order: recordedSteps.length + 1,
        label: 'Acessar URL: ' + (document.title || window.location.pathname),
        action: 'navigate',
        cssSelector: 'body',
        ariaSelector: 'body',
        value: window.location.href,
        waitBeforeMs: 500,
        timeoutMs: 12000,
        isLoopTarget: false,
        url: window.location.href,
      };
      addRecordedStep(step);
    });

    document.getElementById('hud-btn-wait-el')?.addEventListener('click', () => {
      waitingForElementMode = !waitingForElementMode;
      renderHUD();
    });

    document.getElementById('hud-btn-undo')?.addEventListener('click', () => {
      if (recordedSteps.length > 0) {
        const removed = recordedSteps.pop();
        persistSessionState();
        sendLog('info', 'Passo desfeito: ' + removed?.label);
        renderHUD();
      }
    });

    document.getElementById('hud-btn-use-history-back')?.addEventListener('click', () => {
      wizardListConfig.returnMode = 'history_back';
      wizardPhase = 'next_page';
      persistSessionState();
      sendLog('info', 'Retorno configurado para history.back().');
      renderHUD();
    });

    document.getElementById('hud-btn-finish')?.addEventListener('click', finishRecording);
    document.getElementById('hud-btn-close')?.addEventListener('click', cancelRecording);

    hud.querySelectorAll('.hud-del-step').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        if (!isNaN(idx) && idx >= 0 && idx < recordedSteps.length) {
          recordedSteps.splice(idx, 1);
          recordedSteps.forEach((s, i) => {
            s.order = i + 1;
          });
          persistSessionState();
          renderHUD();
        }
      });
    });
  }

  function setupDraggable(hud) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const dragHandle = hud.querySelector('#hud-drag-handle') || hud;

    dragHandle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = hud.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      hud.style.bottom = 'auto';
      hud.style.right = 'auto';
      hud.style.left = `${initialLeft}px`;
      hud.style.top = `${initialTop}px`;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      hud.style.left = `${Math.max(10, Math.min(window.innerWidth - hud.offsetWidth - 10, initialLeft + dx))}px`;
      hud.style.top = `${Math.max(10, Math.min(window.innerHeight - hud.offsetHeight - 10, initialTop + dy))}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function closeHUD() {
    activeRecordingMode = null;
    wizardPhase = null;
    isPaused = false;
    waitingForElementMode = false;
    const hud = document.getElementById('autoapprove-hud');
    if (hud) hud.remove();
  }

  async function finishRecording() {
    chrome.runtime.sendMessage({
      type: 'SAVE_RECORDED_STEPS',
      taskId: currentRecordingTaskId,
      steps: recordedSteps,
      listConfig: wizardListConfig,
    }).catch(() => {});

    await chrome.storage.local.set({
      rpaRecordingSession: { active: false },
    });

    sendLog('success', `Gravação concluída com sucesso! ${recordedSteps.length} passos salvos na tarefa.`);
    closeHUD();
  }

  async function cancelRecording() {
    if (confirm('Deseja cancelar esta gravação? Os passos não salvos serão descartados.')) {
      await chrome.storage.local.set({
        rpaRecordingSession: { active: false },
      });
      chrome.runtime.sendMessage({ type: 'CANCEL_RECORDING_SESSION' }).catch(() => {});
      closeHUD();
      sendLog('warn', 'Gravação cancelada pelo usuário.');
    }
  }

  // Intercepta Ações de Clique do Usuário na Página durante a gravação
  document.addEventListener(
    'click',
    (ev) => {
      if (!activeRecordingMode || isPaused) return;

      const target = ev.target.closest('button, a, input, select, tr, [role="button"], label, textarea') || ev.target;
      if (target.closest('#autoapprove-hud') || target.closest('#autoapprove-exec-hud')) return;

      const selector = getResilientSelector(target);
      const ariaSelector = getAriaSelector(target);
      const xpath = getXPath(target);

      if (waitingForElementMode) {
        ev.preventDefault();
        ev.stopPropagation();
        const step = {
          id: 'step-' + Date.now(),
          order: recordedSteps.length + 1,
          label: getCleanLabel(target, 'wait_visible'),
          action: 'wait_visible',
          cssSelector: selector,
          ariaSelector,
          xpath,
          waitBeforeMs: 300,
          timeoutMs: 12000,
          isLoopTarget: false,
          url: window.location.href,
        };
        waitingForElementMode = false;
        highlightElement(target, '#facc15');
        addRecordedStep(step);
        return;
      }

      const action = target.type === 'checkbox' ? 'check' : target.tagName === 'SELECT' ? 'select' : 'click';
      const label = getCleanLabel(target, action);

      if (activeRecordingMode === 'free') {
        const step = {
          id: 'step-' + Date.now(),
          order: recordedSteps.length + 1,
          label,
          action,
          cssSelector: selector,
          ariaSelector,
          xpath,
          waitBeforeMs: 400,
          timeoutMs: 12000,
          isLoopTarget: false,
          url: window.location.href,
        };

        highlightElement(target);
        addRecordedStep(step);
        return;
      }

      if (activeRecordingMode === 'list_wizard') {
        if (wizardPhase === 'list_row') {
          wizardListConfig.openDetailSelector = selector;
          const row = target.closest('tr, li, .card, [data-id]');
          if (row) wizardListConfig.listRowSelector = getResilientSelector(row);
          wizardPhase = 'detail_steps';
          highlightElement(target);
          persistSessionState();
          sendLog('info', `Fase 1 Gravada: Abertura de item (${selector})`);
          renderHUD();
        } else if (wizardPhase === 'detail_steps') {
          const step = {
            id: 'step-' + Date.now(),
            order: recordedSteps.length + 1,
            label,
            action,
            cssSelector: selector,
            ariaSelector,
            xpath,
            waitBeforeMs: 400,
            timeoutMs: 10000,
            isLoopTarget: true,
            url: window.location.href,
          };
          highlightElement(target);
          addRecordedStep(step);
        } else if (wizardPhase === 'return_action') {
          wizardListConfig.returnSelector = selector;
          wizardListConfig.returnMode = 'click_button';
          wizardPhase = 'next_page';
          highlightElement(target);
          persistSessionState();
          sendLog('info', `Fase 3 Gravada: Botão de Retorno (${selector})`);
          renderHUD();
        } else if (wizardPhase === 'next_page') {
          wizardListConfig.nextPageSelector = selector;
          wizardListConfig.paginationEnabled = true;
          highlightElement(target);
          sendLog('info', `Fase 4 Gravada: Botão de Paginação (${selector})`);
          finishRecording();
        }
      }
    },
    true
  );

  document.addEventListener(
    'change',
    (ev) => {
      if (!activeRecordingMode || isPaused) return;
      const target = ev.target;
      if (target.closest('#autoapprove-hud') || target.closest('#autoapprove-exec-hud')) return;

      const selector = getResilientSelector(target);
      const ariaSelector = getAriaSelector(target);
      const xpath = getXPath(target);

      if (
        (target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio') ||
        target.tagName === 'TEXTAREA'
      ) {
        const step = {
          id: 'step-' + Date.now(),
          order: recordedSteps.length + 1,
          label: getCleanLabel(target, 'fill'),
          action: 'fill',
          cssSelector: selector,
          ariaSelector,
          xpath,
          value: target.value,
          waitBeforeMs: 300,
          timeoutMs: 8000,
          isLoopTarget: false,
          url: window.location.href,
        };
        highlightElement(target);
        addRecordedStep(step);
      } else if (target.tagName === 'SELECT') {
        const step = {
          id: 'step-' + Date.now(),
          order: recordedSteps.length + 1,
          label: getCleanLabel(target, 'select'),
          action: 'select',
          cssSelector: selector,
          ariaSelector,
          xpath,
          value: target.value,
          waitBeforeMs: 250,
          timeoutMs: 6000,
          isLoopTarget: false,
          url: window.location.href,
        };
        highlightElement(target);
        addRecordedStep(step);
      }
    },
    true
  );

  window.addEventListener('beforeunload', () => {
    if (activeRecordingMode) {
      persistSessionState();
    }
  });

  // Re-hidratação Automática de Gravação e de Execução em Andamento
  async function checkAndResumeState() {
    try {
      const { rpaRecordingSession, rpaExecutionSession, rpaTasks = [] } = await chrome.storage.local.get([
        'rpaRecordingSession',
        'rpaExecutionSession',
        'rpaTasks',
      ]);

      // 1. Continuação de Execução Multi-Página
      if (rpaExecutionSession && rpaExecutionSession.active) {
        const targetTask = rpaTasks.find((t) => t.id === rpaExecutionSession.taskId);
        if (targetTask && !isExecuting) {
          sendLog('info', `🌐 Nova página carregada! Retomando execução da tarefa "${targetTask.name}" no passo ${rpaExecutionSession.nextStepIdx}...`);
          // Aguarda página nova estabilizar
          await waitForActionSettled(800);
          executeFreeMacroTask(
            targetTask,
            rpaExecutionSession.config || {},
            rpaExecutionSession.nextStepIdx || 0,
            rpaExecutionSession.cycle || 1
          );
        }
      }

      // 2. Continuação de Gravação Multi-Página
      if (rpaRecordingSession && rpaRecordingSession.active) {
        activeRecordingMode = rpaRecordingSession.mode || 'free';
        currentRecordingTaskId = rpaRecordingSession.taskId;
        recordedSteps = rpaRecordingSession.recordedSteps || [];
        wizardPhase = rpaRecordingSession.wizardPhase || null;
        wizardListConfig = rpaRecordingSession.wizardListConfig || {};
        isPaused = rpaRecordingSession.status === 'paused';
        hudMinimized = Boolean(rpaRecordingSession.hudMinimized);

        const currentUrl = window.location.href;
        const previousUrl = rpaRecordingSession.lastUrl || '';

        if (previousUrl && previousUrl !== currentUrl && !currentUrl.startsWith('chrome-extension://')) {
          lastNavigatedNotice = `Navegação detectada para: ${document.title || currentUrl}`;
          rpaRecordingSession.lastUrl = currentUrl;
          rpaRecordingSession.lastPageTitle = document.title;
          chrome.storage.local.set({ rpaRecordingSession }).catch(() => {});
          sendLog('info', `🌐 [Navegação Detectada] ${document.title} (${currentUrl}) — Gravação preservada!`);
        }

        renderHUD({ justNavigated: lastNavigatedNotice });
      }
    } catch {
      // Ignora erro de contexto
    }
  }

  // Listener de Mensagens da Extensão
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RPA_START_RECORDING') {
      activeRecordingMode = msg.mode || 'free';
      currentRecordingTaskId = msg.taskId;
      recordedSteps = [];
      wizardPhase = activeRecordingMode === 'list_wizard' ? 'list_row' : null;
      wizardListConfig = {};
      isPaused = false;
      hudMinimized = false;
      persistSessionState();
      renderHUD();
      sendLog('info', `Gravador ativado no modo ${activeRecordingMode === 'free' ? 'Livre Universal' : 'Assistente de Tabela'}.`);
      sendResponse({ ok: true });
    } else if (msg.type === 'RPA_RESUME_RECORDING') {
      checkAndResumeState();
      sendResponse({ ok: true });
    } else if (msg.type === 'RPA_STOP_RECORDING') {
      finishRecording();
      sendResponse({ ok: true });
    } else if (msg.type === 'RPA_EXECUTE_TASK') {
      const task = msg.task;
      const cfg = msg.config || {};
      if (task.pattern === 'list_detail_pagination' || task.repeatMode === 'loop_list') {
        executeBatchTableWorkflow(task, cfg);
      } else {
        executeFreeMacroTask(task, cfg);
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'RPA_ABORT') {
      isExecuting = false;
      renderExecutionHUD(null);
      sendLog('warn', 'Execução pausada pelo usuário.');
      closeHUD();
      chrome.storage.local.set({ rpaExecutionSession: { active: false } }).catch(() => {});
      sendResponse({ ok: true });
    } else if (msg.type === 'RPA_PING') {
      sendResponse({ alive: true, recording: Boolean(activeRecordingMode), executing: isExecuting });
    }
    return true;
  });

  // Inicializa verificação de gravação ou execução
  checkAndResumeState();
})();
