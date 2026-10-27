// AutoApprove RPA — Motor Universal de Automação
// Gravação livre na tela, assistente de tabela, execução resiliente e
// disparo correto de comboboxes/dropdowns (clique único, sem piscar).
(function () {
  'use strict';

  if (window.__AUTOAPPROVE_CONTENT_SCRIPT_INITIALIZED__) {
    return;
  }
  window.__AUTOAPPROVE_CONTENT_SCRIPT_INITIALIZED__ = true;

  var HUD_ID = 'autoapprove-hud';
  var EXEC_HUD_ID = 'autoapprove-exec-hud';
  var STYLE_ID = 'autoapprove-hud-styles';
  var MAX_RECORDED_STEPS = 500;

  // Containers de menu usados por Radix, MUI, Ant, react-select, Headless UI, Bootstrap...
  var MENU_SELECTOR = [
    '[role="listbox"]',
    '[role="menu"]',
    '[role="tree"]',
    '[data-radix-popper-content-wrapper]',
    '[data-headlessui-state]',
    '.select__menu',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '.MuiPopover-root',
    '.MuiMenu-root',
    '.MuiAutocomplete-popper',
    '.dropdown-menu',
    'ul.dropdown',
    '.custom-select-menu',
    '.headlessui-listbox-options',
    '.combobox-menu',
  ].join(', ');

  var OPTION_SELECTOR = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="treeitem"]',
    '.select__option',
    '.ant-select-item-option',
    '.MuiMenuItem-root',
    '.MuiAutocomplete-option',
    '.dropdown-item',
    'li',
  ].join(', ');

  // ==========================================
  // ESTADO
  // ==========================================

  var isExecuting = false;
  var isPaused = false;
  var activeRecordingMode = null; // 'free' | 'list_wizard' | null
  var wizardPhase = null; // 'list_row' | 'detail_steps' | 'return_action' | 'next_page'
  var recordedSteps = [];
  var waitingForElementMode = false;
  var hudMinimized = false;
  var openStepMenuId = null;
  var recordingTaskId = null;
  var lastTriggerSelector = null;
  var wizardListConfig = {
    listRowSelector: '',
    openDetailSelector: '',
    returnSelector: '',
    returnMode: 'click_button',
    nextPageSelector: '',
    paginationEnabled: false,
  };

  // ==========================================
  // UTILITÁRIOS BÁSICOS
  // ==========================================

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isHudNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === HUD_ID || node.id === EXEC_HUD_ID) return true;
    if (typeof node.closest !== 'function') return false;
    return Boolean(
      node.closest('#' + HUD_ID) ||
        node.closest('#' + EXEC_HUD_ID) ||
        node.closest('[data-aahud]')
    );
  }

  function safeStoreGet(keys) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(keys, function (result) {
          resolve(result || {});
        });
      } catch (err) {
        resolve({});
      }
    });
  }

  function safeStoreSet(payload) {
    try {
      var maybePromise = chrome.storage.local.set(payload);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(function () {});
      }
    } catch (err) {
      /* storage indisponível: execução continua em memória */
    }
  }

  function safeMessage(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        // Consome o erro "Receiving end does not exist" para não gerar unhandled rejection
        void chrome.runtime.lastError;
      });
    } catch (err) {
      /* service worker hibernando */
    }
  }

  function waitFor(predicate, timeoutMs, intervalMs) {
    var deadline = Date.now() + (Number(timeoutMs) || 1000);
    var step = Number(intervalMs) || 50;
    return new Promise(function (resolve) {
      function tick() {
        var matched = false;
        try {
          matched = Boolean(predicate());
        } catch (err) {
          matched = false;
        }
        if (matched) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, step);
      }
      tick();
    });
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    if (!document.documentElement.contains(element)) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    var style = window.getComputedStyle(element);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') < 0.05) return false;

    var rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && element.children.length === 0) return false;

    return true;
  }

  function isElementActionable(element) {
    if (!element || element.nodeType !== 1) return false;
    if (!document.documentElement.contains(element)) return false;
    if (isHudNode(element)) return false;

    if (element.tagName === 'SELECT') {
      return !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    }

    if (!isVisible(element)) return false;

    if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    if (element.classList.contains('disabled') || element.classList.contains('is-loading')) return false;

    return true;
  }

  // ==========================================
  // SELEÇÃO DE ALVOS (gravação x execução)
  // ==========================================

  var OPTION_ROLE_SELECTOR =
    '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="treeitem"], .select__option, .ant-select-item-option, .MuiMenuItem-root, .MuiAutocomplete-option, .dropdown-item';

  var TRIGGER_SELECTOR =
    'button, a, input, select, textarea, [role="combobox"], [role="button"], [role="tab"], [role="switch"], [aria-haspopup], [data-state], [tabindex]:not([tabindex="-1"]), summary, .select__control, .ant-select-selector, .MuiSelect-select, .headlessui-listbox-button, .dropdown-toggle';

  // Normaliza o elemento alvo durante a gravação. Se o clique caiu dentro de um
  // menu aberto, o alvo é a própria opção (não o gatilho do dropdown).
  function normalizeTargetForRecording(rawElement) {
    if (!rawElement || rawElement.nodeType !== 1) return null;
    if (isHudNode(rawElement)) return null;

    var option = rawElement.closest(OPTION_ROLE_SELECTOR);
    if (option) return option;

    var trigger = rawElement.closest(TRIGGER_SELECTOR);
    if (trigger) return trigger;

    return rawElement;
  }

  // Resolve o elemento que realmente recebe a interação na execução.
  function resolveInteractiveTarget(element) {
    if (!element || element.nodeType !== 1) return element;
    if (isHudNode(element)) return element;

    var tagName = element.tagName;

    if (tagName === 'PATH' || tagName === 'SVG' || (tagName === 'SPAN' && !element.getAttribute('role'))) {
      var parentTrigger = element.closest(TRIGGER_SELECTOR);
      if (parentTrigger) return parentTrigger;
    }

    if (!element.matches('button, select, input, a, textarea, [role="combobox"], [role="option"], [role="menuitem"], [role="button"]')) {
      var innerTrigger = element.querySelector('[role="combobox"], [role="button"], button, select, input');
      if (innerTrigger && element.children.length <= 2) {
        return innerTrigger;
      }
    }

    return element;
  }

  // ==========================================
  // GERADORES DE SELETORES RESILIENTES
  // ==========================================

  function cssEscapeIdent(value) {
    var text = String(value);
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(text);
    }
    return text.replace(/([^\w-])/g, '\\$1');
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function hasStableClass(className) {
    if (!className) return false;
    if (className.length > 40) return false;
    if (/^(css|sc|jsx|emotion|svelte|styled|jss|makeStyles|MuiBox)-/i.test(className)) return false;
    if (/^[a-z]+_[a-zA-Z0-9]{6,}$/.test(className)) return false; // CSS Modules com hash
    if (/[0-9a-f]{8,}/i.test(className)) return false;
    return true;
  }

  function buildCssPath(element) {
    var parts = [];
    var node = element;
    var depth = 0;

    while (node && node.nodeType === 1 && depth < 4) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;

      var segment = tag;

      var stableClasses = Array.prototype.slice
        .call(node.classList || [])
        .filter(hasStableClass)
        .slice(0, 2);
      if (stableClasses.length > 0 && depth < 2) {
        segment += stableClasses.map(function (name) {
          return '.' + cssEscapeIdent(name);
        }).join('');
      }

      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (child) {
          return child.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          segment += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }

      parts.unshift(segment);

      var parentId = parent && parent.id && !/\d{4,}/.test(parent.id) ? parent.id : null;
      if (parentId) {
        parts.unshift('#' + cssEscapeIdent(parentId));
        break;
      }

      node = parent;
      depth += 1;
    }

    return parts.length > 0 ? parts.join(' > ') : 'body';
  }

  function getResilientSelector(element) {
    if (!element || element.nodeType !== 1) return 'body';

    var attributes = ['data-action', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];
    for (var i = 0; i < attributes.length; i += 1) {
      var attributeValue = element.getAttribute(attributes[i]);
      if (attributeValue) {
        return element.tagName.toLowerCase() + '[' + attributes[i] + '="' + escapeAttribute(attributeValue) + '"]';
      }
    }

    if (element.id && !/\d{4,}/.test(element.id) && !/^(:r|react|ng|ember|vue|mui|radix)/i.test(element.id)) {
      return '#' + cssEscapeIdent(element.id);
    }

    var tagName = element.tagName.toLowerCase();
    var nameAttr = element.getAttribute('name');
    if (nameAttr && ['input', 'select', 'textarea', 'button', 'form'].indexOf(tagName) >= 0) {
      return tagName + '[name="' + escapeAttribute(nameAttr) + '"]';
    }

    var typeAttr = element.getAttribute('type');
    if (tagName === 'input' && typeAttr && typeAttr !== 'text') {
      var valueAttr = element.getAttribute('value');
      if (valueAttr && (typeAttr === 'radio' || typeAttr === 'checkbox')) {
        return 'input[type="' + escapeAttribute(typeAttr) + '"][value="' + escapeAttribute(valueAttr) + '"]';
      }
    }

    var ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return tagName + '[aria-label="' + escapeAttribute(ariaLabel) + '"]';
    }

    var role = element.getAttribute('role');
    var innerText = normalizeText(element.innerText || element.textContent || '');
    if (role && innerText && innerText.length <= 40) {
      return tagName + '[role="' + escapeAttribute(role) + '"]';
    }

    if (!isHudNode(element)) {
      var path = buildCssPath(element);
      if (path && path !== 'body') return path;
    }

    return 'body';
  }

  function getXPath(element) {
    if (!element || element.nodeType !== 1) return '';
    if (element.id && !/\d{4,}/.test(element.id)) {
      return '//*[@id="' + escapeAttribute(element.id) + '"]';
    }

    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && node.tagName !== 'HTML') {
      var index = 1;
      var sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return parts.length > 0 ? '/html/body/' + parts.join('/') : '';
  }

  function getAriaSelector(element) {
    if (!element || element.nodeType !== 1) return '';
    var role = element.getAttribute('role') || element.tagName.toLowerCase();
    var ariaLabel = element.getAttribute('aria-label') || element.getAttribute('title');
    if (ariaLabel) return role + '[aria-label="' + escapeAttribute(ariaLabel) + '"]';
    var text = normalizeText(element.innerText || element.textContent || '').slice(0, 40);
    if (text) return role + ':has-text("' + escapeAttribute(text) + '")';
    return role;
  }

  function getCleanLabel(element, actionType) {
    var prefixes = {
      click: 'Clicar em',
      open_dropdown: 'Abrir caixa de seleção',
      choose_option: 'Escolher opção',
      fill: 'Preencher campo',
      check: 'Marcar opção',
      select: 'Selecionar em',
      wait_visible: 'Aguardar elemento',
    };
    var prefix = prefixes[actionType] || prefixes.click;

    var described =
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      (element.labels && element.labels[0] ? element.labels[0].innerText : '') ||
      (element.tagName === 'SELECT'
        ? element.options && element.selectedIndex >= 0
          ? element.options[element.selectedIndex].text
          : ''
        : '') ||
      element.innerText ||
      element.textContent ||
      element.getAttribute('name') ||
      element.tagName.toLowerCase();

    var clean = String(described || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);

    if (!clean) clean = element.tagName.toLowerCase();
    return prefix + ' ' + clean;
  }

  // ==========================================
  // ENGINE DE ESPERA (auto-wait)
  // ==========================================

  async function waitForBlockersToVanish(timeoutMs) {
    var limit = Number(timeoutMs) || 12000;
    var start = Date.now();
    var blockerSelectors = [
      '[aria-busy="true"]',
      '.spinner:not(.hidden)',
      '.loading-spinner:not(.hidden)',
      '.loader:not(.hidden)',
      '[data-loading="true"]',
      '.nprogress-busy',
      '.ant-spin-spinning',
      '.MuiCircularProgress-root',
      '[class*="skeleton"]',
    ];

    while (Date.now() - start < limit) {
      var blocked = false;
      for (var i = 0; i < blockerSelectors.length; i += 1) {
        var nodes;
        try {
          nodes = document.querySelectorAll(blockerSelectors[i]);
        } catch (err) {
          continue;
        }
        for (var j = 0; j < nodes.length; j += 1) {
          if (isVisible(nodes[j])) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }

      if (!blocked) return true;
      await sleep(150);
    }

    return false;
  }

  function waitForDomMutationQuiet(quietMs, maxWaitMs) {
    var quietWindow = Number(quietMs) || 350;
    var maximum = Number(maxWaitMs) || 6000;

    return new Promise(function (resolve) {
      var quietTimer = null;
      var totalTimer = null;
      var finished = false;

      var observer = new MutationObserver(function () {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietWindow);
      });

      function finish() {
        if (finished) return;
        finished = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (totalTimer) clearTimeout(totalTimer);
        observer.disconnect();
        resolve(true);
      }

      try {
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      } catch (err) {
        finish();
        return;
      }

      totalTimer = setTimeout(finish, maximum);
      quietTimer = setTimeout(finish, quietWindow);
    });
  }

  async function waitForActionSettled(baseExtraMs) {
    await waitForBlockersToVanish(10000);
    await waitForDomMutationQuiet(300, 5000);

    if (document.readyState !== 'complete') {
      await new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          document.removeEventListener('DOMContentLoaded', finish);
          window.removeEventListener('load', finish);
          resolve();
        }
        document.addEventListener('DOMContentLoaded', finish, { once: true });
        window.addEventListener('load', finish, { once: true });
        setTimeout(finish, 4000);
      });
    }

    var extra = Number(baseExtraMs) || 0;
    if (extra > 0) await sleep(extra);
  }

  // ==========================================
  // LOCALIZAÇÃO DE ELEMENTOS NA EXECUÇÃO
  // ==========================================

  function isMenuElementVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    if (!document.documentElement.contains(element)) return false;
    if (isHudNode(element)) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    var style = window.getComputedStyle(element);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    var rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function findOpenMenu() {
    var candidates;
    try {
      candidates = document.querySelectorAll(MENU_SELECTOR);
    } catch (err) {
      return null;
    }

    for (var i = 0; i < candidates.length; i += 1) {
      if (isMenuElementVisible(candidates[i])) return candidates[i];
    }
    return null;
  }

  function isDropdownExpanded(trigger) {
    if (!trigger) return Boolean(findOpenMenu());

    if (trigger.getAttribute('aria-expanded') === 'true') return true;
    if (trigger.getAttribute('data-state') === 'open') return true;
    if (trigger.getAttribute('data-headlessui-state') === 'open') return true;

    var controlled = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
    if (controlled) {
      try {
        var panel = document.getElementById(controlled);
        if (panel && isMenuElementVisible(panel)) return true;
      } catch (err) {
        /* id inválido */
      }
    }

    return Boolean(findOpenMenu());
  }

  function optionRank(element) {
    var role = element.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox') return 0;
    if (element.classList.contains('select__option')) return 1;
    if (element.classList.contains('ant-select-item-option')) return 2;
    if (element.classList.contains('MuiMenuItem-root')) return 2;
    if (element.classList.contains('dropdown-item')) return 3;
    if (element.tagName === 'LI') return 4;
    return 5;
  }

  function findOptionByText(scope, wantedText) {
    var wanted = normalizeText(wantedText);
    if (!wanted) return null;

    var root = scope || document;
    var candidates;
    try {
      candidates = Array.prototype.slice.call(root.querySelectorAll(OPTION_SELECTOR));
    } catch (err) {
      return null;
    }

    var best = null;
    var bestScore = -1;

    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      if (!isMenuElementVisible(candidate)) continue;
      if (isHudNode(candidate)) continue;

      var text = normalizeText(
        candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label') || ''
      );
      if (!text) continue;

      var score = -1;
      if (text === wanted) score = 100;
      else if (text.indexOf(wanted) === 0) score = 70;
      else if (text.indexOf(wanted) >= 0) score = 50;

      if (score < 0) continue;

      // Desempate por semântica de opção (role=option vence um <li> genérico)
      score -= optionRank(candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  async function findActionableElement(step, timeoutMs) {
    var limit = Number(timeoutMs) || 15000;
    var start = Date.now();

    while (Date.now() - start < limit) {
      if (!isExecuting) throw new Error('Execução cancelada pelo usuário.');

      // 0. Opções de dropdown: procurar primeiro dentro dos menus abertos.
      //    O seletor CSS de uma opção costuma apontar para um nó já descartado
      //    pelo framework, o que fazia o robô clicar no elemento errado.
      if (step.isOption || step.role === 'option') {
        var wantedOption = step.optionText || step.value || stripLabelPrefix(step.label);
        var inMenu = findOptionByText(findOpenMenu(), wantedOption);
        if (inMenu) return inMenu;
      }

      // 1. Seletor CSS gravado
      if (step.cssSelector) {
        try {
          var byCss = document.querySelector(step.cssSelector);
          if (byCss && isElementActionable(byCss)) {
            return resolveInteractiveTarget(byCss);
          }
        } catch (err) {
          /* seletor inválido */
        }
      }

      // 2. XPath gravado
      if (step.xpath) {
        try {
          var xpathResult = document.evaluate(
            step.xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          if (xpathResult.singleNodeValue && isElementActionable(xpathResult.singleNodeValue)) {
            return resolveInteractiveTarget(xpathResult.singleNodeValue);
          }
        } catch (err) {
          /* xpath inválido */
        }
      }

      // 3. Busca por texto/rótulo entre elementos interativos
      var cleanLabel = stripLabelPrefix(step.label);
      if (cleanLabel && cleanLabel.length >= 2) {
        var candidates = document.querySelectorAll(
          'button, a, input, select, textarea, [role="combobox"], [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="switch"], [role="listbox"], li, label, summary, [aria-haspopup], [data-state], .select__control, .ant-select-selector, .MuiSelect-select, .dropdown-item, .dropdown-toggle, tr, td, th'
        );
        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          if (!isElementActionable(candidate)) continue;

          var text = normalizeText(
            candidate.innerText ||
              candidate.textContent ||
              candidate.getAttribute('aria-label') ||
              candidate.getAttribute('placeholder') ||
              candidate.getAttribute('title') ||
              candidate.id ||
              ''
          );
          if (text && text.indexOf(cleanLabel) >= 0) {
            return resolveInteractiveTarget(candidate);
          }
        }
      }

      await sleep(200);
    }

    throw new Error(
      'Tempo limite (' +
        Math.round(limit / 1000) +
        's) aguardando o elemento: ' +
        (step.label || step.cssSelector || 'desconhecido')
    );
  }

  function stripLabelPrefix(label) {
    return normalizeText(label).replace(
      /^(clicar em|abrir caixa de seleção|escolher opção|preencher campo|marcar opção|selecionar em|aguardar elemento)\s*/i,
      ''
    );
  }

  function resolveTriggerForStep(step) {
    var explicit = step && (step.parentTriggerSelector || step.triggerSelector);
    if (explicit) {
      try {
        var node = document.querySelector(explicit);
        if (node && isElementActionable(node)) return node;
      } catch (err) {
        /* seletor inválido */
      }
    }

    var expanded = document.querySelector(
      '[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"], [data-state="open"][role="combobox"]'
    );
    if (expanded && isElementActionable(expanded)) return expanded;

    return null;
  }

  // ==========================================
  // DISPARO DE EVENTOS (clique único e realista)
  // ==========================================

  function buildEventInit(element, step) {
    var rect = element.getBoundingClientRect();
    var xPct = step && step.coords && step.coords.xPct != null ? Number(step.coords.xPct) : 0.5;
    var yPct = step && step.coords && step.coords.yPct != null ? Number(step.coords.yPct) : 0.5;

    var width = Math.max(rect.width, 1);
    var height = Math.max(rect.height, 1);
    var offsetX = Math.min(Math.max(width * xPct, 1), width - 1);
    var offsetY = Math.min(Math.max(height * yPct, 1), height - 1);

    var clientX = Math.round(rect.left + offsetX);
    var clientY = Math.round(rect.top + offsetY);

    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX: clientX,
      clientY: clientY,
      screenX: Math.round((window.screenX || 0) + clientX),
      screenY: Math.round((window.screenY || 0) + clientY),
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };
  }

  function dispatchPointer(element, type, init, buttons, button) {
    var event;
    try {
      event = new PointerEvent(type, {
        bubbles: init.bubbles,
        cancelable: init.cancelable,
        composed: init.composed,
        view: init.view,
        detail: init.detail,
        clientX: init.clientX,
        clientY: init.clientY,
        screenX: init.screenX,
        screenY: init.screenY,
        button: button || 0,
        buttons: buttons || 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: buttons > 0 ? 0.5 : 0,
      });
    } catch (err) {
      event = new MouseEvent(type, {
        bubbles: init.bubbles,
        cancelable: init.cancelable,
        composed: init.composed,
        view: init.view,
        detail: init.detail,
        clientX: init.clientX,
        clientY: init.clientY,
        screenX: init.screenX,
        screenY: init.screenY,
        button: button || 0,
        buttons: buttons || 0,
      });
    }
    element.dispatchEvent(event);
  }

  function dispatchMouse(element, type, init, buttons) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: init.bubbles,
        cancelable: init.cancelable,
        composed: init.composed,
        view: init.view,
        detail: init.detail,
        clientX: init.clientX,
        clientY: init.clientY,
        screenX: init.screenX,
        screenY: init.screenY,
        button: 0,
        buttons: buttons || 0,
      })
    );
  }

  // Hover + pressionamento: é o que bibliotecas como Radix, MUI e react-select
  // usam para abrir o dropdown no pointerdown/mousedown.
  function dispatchPressAndRelease(element, init) {
    dispatchPointer(element, 'pointerover', init, 0, 0);
    dispatchMouse(element, 'mouseover', init, 0);
    dispatchPointer(element, 'pointerenter', init, 0, 0);
    dispatchMouse(element, 'mouseenter', init, 0);
    dispatchPointer(element, 'pointermove', init, 0, 0);
    dispatchMouse(element, 'mousemove', init, 0);
    dispatchPointer(element, 'pointerdown', init, 1, 0);
    dispatchMouse(element, 'mousedown', init, 1);
  }

  function dispatchRelease(element, init) {
    dispatchPointer(element, 'pointerup', init, 0, 0);
    dispatchMouse(element, 'mouseup', init, 0);
  }

  function focusElement(element) {
    try {
      if (document.activeElement !== element) {
        element.focus({ preventScroll: true });
      }
    } catch (err) {
      try {
        element.focus();
      } catch (innerErr) {
        /* elemento não focável */
      }
    }
    try {
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    } catch (err) {
      /* FocusEvent indisponível */
    }
  }

  // Um único evento de clique: disparar o evento sintético E chamar o clique
  // nativo disparava dois cliques e fazia menus/accordions abrirem e fecharem
  // na mesma execução (o bug do dropdown piscando).
  function clickOnce(element) {
    try {
      element.click();
      return true;
    } catch (err) {
      try {
        var init = buildEventInit(element, null);
        dispatchMouse(element, 'click', init, 0);
        return true;
      } catch (innerErr) {
        return false;
      }
    }
  }

  function sendKey(element, key) {
    var keyCodes = { ArrowDown: 40, ArrowUp: 38, Enter: 13, ' ': 32, Escape: 27 };
    var code = keyCodes[key] || 0;
    var options = {
      key: key,
      code: key === ' ' ? 'Space' : key,
      keyCode: code,
      which: code,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    try {
      element.dispatchEvent(new KeyboardEvent('keydown', options));
      element.dispatchEvent(new KeyboardEvent('keypress', options));
      element.dispatchEvent(new KeyboardEvent('keyup', options));
    } catch (err) {
      /* KeyboardEvent indisponível */
    }
  }

  // Abre um dropdown/combobox SEM alternar duas vezes. Cada estratégia é
  // verificada; assim que o menu está aberto, as demais não são executadas.
  async function ensureDropdownOpen(trigger) {
    if (!trigger) return false;
    if (isDropdownExpanded(trigger)) return true;

    focusElement(trigger);

    var init = buildEventInit(trigger, null);

    // Estratégia 1: sequência real de mouse, com o clique só se ainda fechado
    dispatchPressAndRelease(trigger, init);
    await sleep(30);

    if (isDropdownExpanded(trigger)) {
      dispatchRelease(trigger, init);
      return true;
    }

    dispatchRelease(trigger, init);

    if (isDropdownExpanded(trigger)) return true;

    clickOnce(trigger);

    if (await waitFor(function () { return isDropdownExpanded(trigger); }, 700, 50)) {
      return true;
    }

    // Estratégia 2: teclado WAI-ARIA (comboboxes acessíveis)
    sendKey(trigger, 'ArrowDown');
    if (await waitFor(function () { return isDropdownExpanded(trigger); }, 600, 50)) {
      return true;
    }

    // Estratégia 3: Enter (alguns comboboxes só abrem via teclado)
    sendKey(trigger, 'Enter');
    if (await waitFor(function () { return isDropdownExpanded(trigger); }, 600, 50)) {
      return true;
    }

    // Estratégia 4: clique nativo isolado como último recurso
    if (typeof trigger.showPicker === 'function') {
      try {
        trigger.showPicker();
      } catch (err) {
        /* showPicker exige gesto do usuário */
      }
    }
    clickOnce(trigger);

    return waitFor(function () { return isDropdownExpanded(trigger); }, 800, 50);
  }

  async function clickOption(optionElement) {
    if (!optionElement) return false;

    try {
      optionElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (err) {
      /* scroll indisponível */
    }

    var init = buildEventInit(optionElement, null);
    dispatchPressAndRelease(optionElement, init);
    await sleep(25);
    dispatchRelease(optionElement, init);

    if (!findOpenMenu()) {
      // O menu já fechou no pointerup/mouseup: a opção foi aplicada.
      return true;
    }

    clickOnce(optionElement);

    var closed = await waitFor(function () { return !findOpenMenu(); }, 400, 50);
    if (closed) return true;

    // Alguns componentes aplicam a seleção apenas no segundo disparo completo.
    dispatchPressAndRelease(optionElement, init);
    dispatchRelease(optionElement, init);
    clickOnce(optionElement);

    closed = await waitFor(function () { return !findOpenMenu(); }, 600, 50);
    return closed;
  }

  function deriveOptionText(step) {
    if (!step) return '';
    return (
      step.optionText ||
      step.value ||
      stripLabelPrefix(step.label) ||
      ''
    );
  }

  // Executa um passo que escolhe uma opção em dropdown customizado.
  async function chooseOptionStep(step) {
    var wanted = deriveOptionText(step);

    var option = findOptionByText(findOpenMenu(), wanted);
    if (option) {
      await clickOption(option);
      return true;
    }

    // O menu pode ter sido fechado por um clique duplo anterior ou nunca ter
    // aberto: reabre pelo gatilho gravado e tenta de novo.
    var trigger = resolveTriggerForStep(step);
    if (!trigger && step.cssSelector) {
      try {
        var candidate = document.querySelector(step.cssSelector);
        if (candidate && isElementActionable(candidate)) {
          trigger = resolveInteractiveTarget(candidate);
        }
      } catch (err) {
        /* seletor inválido */
      }
    }

    if (trigger) {
      await ensureDropdownOpen(trigger);
      await sleep(150);
      option = findOptionByText(findOpenMenu(), wanted);
    }

    if (!option) {
      option = findOptionByText(null, wanted);
    }

    if (!option) {
      throw new Error('Opção "' + wanted + '" não encontrada no dropdown aberto.');
    }

    await clickOption(option);
    return true;
  }

  async function performNativeSelect(element, value) {
    var wanted = String(value == null ? '' : value);
    var options = Array.prototype.slice.call(element.options || []);

    var match =
      options.filter(function (option) { return option.value === wanted; })[0] ||
      options.filter(function (option) { return normalizeText(option.text) === normalizeText(wanted); })[0] ||
      options.filter(function (option) { return normalizeText(option.text).indexOf(normalizeText(wanted)) >= 0; })[0];

    if (!match) {
      throw new Error('Valor "' + wanted + '" não existe no select ' + (element.name || element.id || ''));
    }

    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, match.value);
    } else {
      element.value = match.value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    if (element.getAttribute('aria-label') || element.labels) {
      // Mantém o foco coerente para validadores que dependem de blur
      try {
        element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      } catch (err) {
        /* ignore */
      }
    }

    return true;
  }

  async function performFill(element, value) {
    var text = String(value == null ? '' : value);

    try {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (err) {
      /* ignore */
    }

    focusElement(element);

    if (element.isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    var prototype =
      element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;

    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }

    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
  }

  // Ação principal de clique: decide entre select nativo, checkbox, combobox e
  // clique comum — sempre com UMA ativação.
  async function performClick(rawElement, step) {
    var element = resolveInteractiveTarget(rawElement);
    if (!element) throw new Error('Elemento de clique não encontrado.');

    step = step || {};

    try {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch (err) {
      /* ignore */
    }

    highlightElement(element, '#2563eb');
    await sleep(120);

    if (element.tagName === 'SELECT') {
      return performNativeSelect(element, step.value || step.optionText || '');
    }

    var isCombobox =
      element.getAttribute('role') === 'combobox' ||
      element.getAttribute('aria-haspopup') === 'listbox' ||
      element.getAttribute('aria-haspopup') === 'menu' ||
      element.getAttribute('aria-haspopup') === 'tree' ||
      element.getAttribute('aria-haspopup') === 'grid' ||
      element.getAttribute('aria-haspopup') === 'true' ||
      element.classList.contains('select__control') ||
      element.classList.contains('ant-select-selector') ||
      element.classList.contains('MuiSelect-select') ||
      element.classList.contains('headlessui-listbox-button') ||
      element.classList.contains('dropdown-toggle');

    if (isCombobox) {
      return ensureDropdownOpen(element);
    }

    var isCheckable =
      element.type === 'checkbox' ||
      element.type === 'radio' ||
      element.getAttribute('role') === 'checkbox' ||
      element.getAttribute('role') === 'switch';

    if (isCheckable) {
      return clickOnce(element);
    }

    // Opções de menu têm caminho próprio (e nunca recebem a sequência duas vezes).
    if (element.matches(OPTION_ROLE_SELECTOR) || element.getAttribute('role') === 'option') {
      return clickOption(element);
    }

    var init = buildEventInit(element, step);
    dispatchPressAndRelease(element, init);
    dispatchRelease(element, init);

    // Um único clique — o dobro de cliques fazia modais e menus fecharem sozinhos.
    clickOnce(element);
    await sleep(40);
    return true;
  }

  // ==========================================
  // REALCE VISUAL E LOGS
  // ==========================================

  function highlightElement(element, color) {
    if (!element || element.nodeType !== 1) return;
    try {
      var previousOutline = element.style.outline;
      var previousOffset = element.style.outlineOffset;
      element.style.outline = '3px solid ' + (color || '#10b981');
      element.style.outlineOffset = '2px';
      setTimeout(function () {
        try {
          element.style.outline = previousOutline;
          element.style.outlineOffset = previousOffset;
        } catch (err) {
          /* ignore */
        }
      }, 900);
    } catch (err) {
      /* ignore */
    }
  }

  function sendLog(level, message, outcome) {
    var entry = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      level: level || 'info',
      message: String(message == null ? '' : message),
      outcome: outcome || null,
    };

    safeMessage({ type: 'UPDATE_STATS', logEntry: entry });
    return entry;
  }

  // ==========================================
  // ESTILOS DO HUD
  // ==========================================

  function ensureHudStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-aahud', 'styles');
    style.textContent = [
      '#' + HUD_ID + ', #' + EXEC_HUD_ID + ' { position: fixed; z-index: 2147483647; }',
      '#' + HUD_ID + ' { right: 24px; bottom: 24px; width: 380px; max-width: calc(100vw - 32px);',
      '  background: #0f172a; color: #f8fafc; border: 2px solid #ef4444; border-radius: 14px;',
      '  box-shadow: 0 24px 48px -12px rgba(0,0,0,.65); font-family: system-ui, -apple-system, Segoe UI, sans-serif;',
      '  font-size: 13px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }',
      '#' + HUD_ID + '.is-minimized { width: auto; padding: 8px 12px; border-radius: 9999px; }',
      '.aahud-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;',
      '  border-bottom: 1px solid #334155; padding-bottom: 8px; cursor: move; user-select: none; }',
      '.aahud-head-title { display: flex; align-items: center; gap: 8px; font-size: 12px;',
      '  letter-spacing: .04em; text-transform: uppercase; color: #f87171; font-weight: 700; }',
      '.aahud-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444;',
      '  box-shadow: 0 0 0 0 rgba(239,68,68,.7); animation: aahud-pulse 1.4s infinite; display: inline-block; }',
      '@keyframes aahud-pulse { 70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }',
      '.aahud-counter { background: #1e293b; color: #38bdf8; font-size: 11px; font-weight: 700;',
      '  padding: 2px 8px; border-radius: 9999px; }',
      '.aahud-hint { background: #1e293b; color: #e2e8f0; padding: 8px 10px; border-radius: 8px;',
      '  font-size: 12px; line-height: 1.45; }',
      '.aahud-hint strong { color: #93c5fd; }',
      '.aahud-steps { max-height: 190px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;',
      '  background: #020617; padding: 6px; border-radius: 8px; }',
      '.aahud-empty { color: #64748b; font-size: 11px; text-align: center; padding: 14px 0; line-height: 1.5; }',
      '.aahud-step { background: #0f172a; border: 1px solid transparent; border-radius: 6px; }',
      '.aahud-step.is-open { border-color: #334155; }',
      '.aahud-step-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; font-size: 11px; color: #cbd5e1; }',
      '.aahud-order { color: #38bdf8; font-weight: 700; min-width: 22px; }',
      '.aahud-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.aahud-kind { color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }',
      '.aahud-mini { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 5px;',
      '  font-size: 10px; font-weight: 700; padding: 3px 6px; cursor: pointer; line-height: 1; }',
      '.aahud-mini:hover { background: #334155; }',
      '.aahud-mini.is-accent { background: #0369a1; border-color: #0ea5e9; color: #e0f2fe; }',
      '.aahud-step-menu { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 6px 6px; }',
      '.aahud-step-menu button { flex: 1 1 46%; }',
      '.aahud-menu-btn { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 5px;',
      '  font-size: 10px; padding: 4px 6px; cursor: pointer; text-align: center; }',
      '.aahud-menu-btn:hover { background: #334155; }',
      '.aahud-menu-btn.is-danger { background: #7f1d1d; border-color: #b91c1c; color: #fee2e2; }',
      '.aahud-menu-btn.is-danger:hover { background: #991b1b; }',
      '.aahud-actions { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid #334155; padding-top: 8px; }',
      '.aahud-btn { background: #334155; border: none; color: #fff; padding: 7px 9px; border-radius: 6px;',
      '  font-size: 11px; cursor: pointer; font-weight: 600; }',
      '.aahud-btn:hover { background: #475569; }',
      '.aahud-btn.is-wide { flex: 1 1 auto; }',
      '.aahud-btn.is-primary { background: #10b981; }',
      '.aahud-btn.is-primary:hover { background: #059669; }',
      '.aahud-btn.is-warn { background: #f59e0b; }',
      '.aahud-btn.is-danger { background: #ef4444; }',
      '.aahud-btn.is-danger:hover { background: #dc2626; }',
      '.aahud-btn[disabled] { opacity: .45; cursor: not-allowed; }',
      '.aahud-alert { background: #064e3b; border: 1px solid #10b981; color: #a7f3d0;',
      '  padding: 6px 10px; border-radius: 6px; font-size: 11px; display: flex; gap: 8px;',
      '  align-items: center; justify-content: space-between; }',
      '.aahud-exec { right: 24px; bottom: 24px; background: #0f172a; color: #e2e8f0; border: 2px solid #2563eb;',
      '  border-radius: 12px; padding: 10px 12px; font-family: system-ui, sans-serif; font-size: 12px;',
      '  display: flex; gap: 10px; align-items: center; box-shadow: 0 18px 36px -12px rgba(0,0,0,.6); max-width: 360px; }',
      '.aahud-exec-bar { width: 84px; height: 6px; background: #1e293b; border-radius: 9999px; overflow: hidden; }',
      '.aahud-exec-fill { height: 100%; background: #38bdf8; transition: width .25s ease; }',
    ].join('\n');

    (document.head || document.documentElement).appendChild(style);
  }

  // ==========================================
  // HUD DE GRAVAÇÃO
  // ==========================================

  function persistSessionState() {
    if (!activeRecordingMode) return;

    safeStoreSet({
      rpaRecordingSession: {
        active: true,
        mode: activeRecordingMode,
        taskId: recordingTaskId,
        status: isPaused ? 'paused' : 'recording',
        recordedSteps: recordedSteps,
        wizardPhase: wizardPhase,
        wizardListConfig: wizardListConfig,
        lastUrl: window.location.href,
        lastPageTitle: document.title,
        hudMinimized: hudMinimized,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  function renumberSteps() {
    recordedSteps.forEach(function (step, index) {
      step.order = index + 1;
    });
  }

  function addRecordedStep(step) {
    if (!step) return;
    recordedSteps.push(step);
    if (recordedSteps.length > MAX_RECORDED_STEPS) {
      recordedSteps = recordedSteps.slice(-MAX_RECORDED_STEPS);
    }
    renumberSteps();
    persistSessionState();
    safeMessage({
      type: 'SYNC_RECORDING_STEP',
      stepCount: recordedSteps.length,
      lastStep: step,
      taskId: recordingTaskId,
    });
    renderHUD();
  }

  function insertStepAfter(stepId, step) {
    var index = recordedSteps.findIndex(function (item) {
      return item.id === stepId;
    });
    if (index < 0) return false;
    recordedSteps.splice(index + 1, 0, step);
    renumberSteps();
    persistSessionState();
    renderHUD();
    return true;
  }

  function removeStep(stepId) {
    var before = recordedSteps.length;
    recordedSteps = recordedSteps.filter(function (item) {
      return item.id !== stepId;
    });
    renumberSteps();
    persistSessionState();
    renderHUD();
    return recordedSteps.length !== before;
  }

  function moveStep(stepId, direction) {
    var index = recordedSteps.findIndex(function (item) {
      return item.id === stepId;
    });
    if (index < 0) return false;
    var target = index + direction;
    if (target < 0 || target >= recordedSteps.length) return false;

    var moved = recordedSteps.splice(index, 1)[0];
    recordedSteps.splice(target, 0, moved);
    renumberSteps();
    persistSessionState();
    renderHUD();
    return true;
  }

  function duplicateStep(stepId) {
    var index = recordedSteps.findIndex(function (item) {
      return item.id === stepId;
    });
    if (index < 0) return false;
    var clone = Object.assign({}, recordedSteps[index], {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      order: index + 2,
    });
    recordedSteps.splice(index + 1, 0, clone);
    renumberSteps();
    persistSessionState();
    renderHUD();
    return true;
  }

  function makeDelayStep(baseStepId, seconds, isLoopTarget) {
    var anchor = recordedSteps.find(function (item) {
      return item.id === baseStepId;
    });
    var safeSeconds = Math.max(0.1, Number(seconds) || 2);

    return {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      order: 0,
      label: 'Aguardar ' + safeSeconds + 's',
      action: 'sleep',
      value: Math.round(safeSeconds * 1000),
      cssSelector: '',
      waitBeforeMs: 0,
      timeoutMs: Math.round(safeSeconds * 1000) + 1000,
      isLoopTarget: typeof isLoopTarget === 'boolean' ? isLoopTarget : Boolean(anchor && anchor.isLoopTarget),
      url: window.location.href,
    };
  }

  function handleStepAction(action, stepId) {
    if (action === 'menu') {
      openStepMenuId = openStepMenuId === stepId ? null : stepId;
      renderHUD();
      return;
    }

    if (action === 'delay-1' || action === 'delay-2' || action === 'delay-5') {
      var seconds = action === 'delay-1' ? 1 : action === 'delay-2' ? 2 : 5;
      insertStepAfter(stepId, makeDelayStep(stepId, seconds));
      sendLog('info', 'Adicionado ' + seconds + 's de espera após o passo.');
      return;
    }

    if (action === 'delay-custom') {
      var answer = window.prompt('Tempo de espera em segundos após este passo:', '2');
      if (answer == null) return;
      var parsed = Number(String(answer).replace(',', '.'));
      if (!parsed || parsed <= 0) {
        window.alert('Informe um número de segundos maior que zero.');
        return;
      }
      insertStepAfter(stepId, makeDelayStep(stepId, parsed));
      return;
    }

    if (action === 'wait-edit') {
      var step = recordedSteps.find(function (item) {
        return item.id === stepId;
      });
      if (!step) return;
      var current = Math.round((Number(step.waitBeforeMs) || 0) / 1000 * 10) / 10;
      var input = window.prompt('Espera ANTES deste passo, em segundos:', String(current));
      if (input == null) return;
      var value = Number(String(input).replace(',', '.'));
      if (Number.isNaN(value) || value < 0) {
        window.alert('Valor inválido.');
        return;
      }
      step.waitBeforeMs = Math.round(value * 1000);
      persistSessionState();
      renderHUD();
      return;
    }

    if (action === 'move-up') {
      moveStep(stepId, -1);
      return;
    }

    if (action === 'move-down') {
      moveStep(stepId, 1);
      return;
    }

    if (action === 'duplicate') {
      duplicateStep(stepId);
      return;
    }

    if (action === 'delete') {
      removeStep(stepId);
      sendLog('info', 'Passo removido da gravação.');
    }
  }

  function bindHudEvents(hud) {
    hud.addEventListener('click', function (event) {
      var actionNode = event.target && event.target.closest ? event.target.closest('[data-hud-act]') : null;
      if (!actionNode || !hud.contains(actionNode)) return;

      event.preventDefault();
      event.stopPropagation();

      var action = actionNode.getAttribute('data-hud-act');
      var stepId = actionNode.getAttribute('data-step-id') || '';

      switch (action) {
        case 'minimize':
          hudMinimized = true;
          persistSessionState();
          renderHUD();
          break;
        case 'expand':
          hudMinimized = false;
          persistSessionState();
          renderHUD();
          break;
        case 'toggle-pause':
          isPaused = !isPaused;
          persistSessionState();
          renderHUD();
          sendLog('info', isPaused ? 'Gravação pausada pelo usuário.' : 'Gravação retomada.');
          break;
        case 'dismiss-nav':
          var alertNode = document.getElementById('aahud-nav-alert');
          if (alertNode) alertNode.remove();
          break;
        case 'add-delay':
          handleStepAction('delay-custom', stepId || (recordedSteps[recordedSteps.length - 1] || {}).id);
          break;
        case 'add-nav':
          var url = window.prompt('URL para navegação programada:', window.location.href);
          if (url && url.trim()) {
            addRecordedStep({
              id: 'step-' + Date.now(),
              order: recordedSteps.length + 1,
              label: 'Navegar para ' + url.trim(),
              action: 'navigate',
              value: url.trim(),
              cssSelector: '',
              waitBeforeMs: 500,
              timeoutMs: 20000,
              isLoopTarget: false,
              url: window.location.href,
            });
          }
          break;
        case 'wait-element':
          waitingForElementMode = true;
          renderHUD();
          sendLog('info', 'Clique no elemento que a automação deve aguardar ficar visível.');
          break;
        case 'undo':
          if (recordedSteps.length > 0) {
            var removed = recordedSteps.pop();
            renumberSteps();
            persistSessionState();
            sendLog('info', 'Passo desfeito: ' + (removed.label || ''));
            renderHUD();
          }
          break;
        case 'history-back':
          wizardListConfig.returnMode = 'history_back';
          wizardPhase = 'next_page';
          persistSessionState();
          renderHUD();
          break;
        case 'finish':
          finishRecording();
          break;
        case 'cancel':
          cancelRecording();
          break;
        default:
          handleStepAction(action, stepId);
          break;
      }
    });
  }

  function renderHUD(options) {
    if (!activeRecordingMode) {
      closeHUD();
      return;
    }

    ensureHudStyles();
    options = options || {};

    var hud = document.getElementById(HUD_ID);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = HUD_ID;
      hud.setAttribute('data-aahud', 'root');
      hud.addEventListener('mousedown', function (event) {
        // impede que o clique no HUD seja interpretado como interação da página
        event.stopPropagation();
      });
      (document.body || document.documentElement).appendChild(hud);
      bindHudEvents(hud);
    }

    if (hudMinimized) {
      hud.classList.add('is-minimized');
      hud.innerHTML =
        '<div class="aahud-head" id="aahud-drag-handle" style="border:none;padding:0;gap:10px">' +
          '<span class="aahud-dot"></span>' +
          '<strong style="font-size:12px">REC (' + recordedSteps.length + ')</strong>' +
          '<button type="button" class="aahud-mini" data-hud-act="expand">Expandir</button>' +
          '<button type="button" class="aahud-mini is-accent" data-hud-act="finish">Salvar</button>' +
        '</div>';
      setupDraggable(hud);
      return;
    }

    hud.classList.remove('is-minimized');

    var isList = activeRecordingMode === 'list_wizard';
    var phaseInstruction = '';

    if (isList) {
      if (wizardPhase === 'list_row') {
        phaseInstruction =
          '<strong>Passo 1:</strong> clique no botão que abre o item da tabela (Abrir, Detalhes, Aprovar...).';
      } else if (wizardPhase === 'detail_steps') {
        phaseInstruction =
          '<strong>Passo 2:</strong> interaja com os campos do modal (dropdowns, checkboxes, aprovar).';
      } else if (wizardPhase === 'return_action') {
        phaseInstruction =
          '<strong>Passo 3:</strong> clique no botão que fecha o modal e volta para a lista.';
      } else if (wizardPhase === 'next_page') {
        phaseInstruction =
          '<strong>Passo 4:</strong> clique no botão de próxima página (ou finalize se não houver).';
      }
    } else {
      phaseInstruction =
        '<strong>Gravação ativa:</strong> interaja normalmente. Cada clique, digitação e seleção é capturado.';
    }

    var stepsHtml = recordedSteps
      .map(function (step, index) {
        var menuOpen = openStepMenuId === step.id;
        var kind = step.action === 'sleep' ? 'espera' : step.action === 'navigate' ? 'navegar' : step.action;

        return (
          '<div class="aahud-step' + (menuOpen ? ' is-open' : '') + '">' +
            '<div class="aahud-step-row">' +
              '<span class="aahud-order">#' + (index + 1) + '</span>' +
              '<span class="aahud-label" title="' + escapeHtml(step.label) + '">' + escapeHtml(step.label) + '</span>' +
              '<span class="aahud-kind">' + escapeHtml(kind) + '</span>' +
              '<button type="button" class="aahud-mini is-accent" data-hud-act="delay-2" data-step-id="' + escapeHtml(step.id) + '" ' +
                'title="Adicionar 2 segundos de espera depois deste passo">+2s</button>' +
              '<button type="button" class="aahud-mini" data-hud-act="menu" data-step-id="' + escapeHtml(step.id) + '" ' +
                'title="Mais ações deste passo">⋮</button>' +
            '</div>' +
            (menuOpen
              ? '<div class="aahud-step-menu">' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="delay-1" data-step-id="' + escapeHtml(step.id) + '">+1s</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="delay-2" data-step-id="' + escapeHtml(step.id) + '">+2s</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="delay-5" data-step-id="' + escapeHtml(step.id) + '">+5s</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="delay-custom" data-step-id="' + escapeHtml(step.id) + '">Espera…</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="wait-edit" data-step-id="' + escapeHtml(step.id) + '">Espera antes</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="move-up" data-step-id="' + escapeHtml(step.id) + '">↑ Subir</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="move-down" data-step-id="' + escapeHtml(step.id) + '">↓ Descer</button>' +
                  '<button type="button" class="aahud-menu-btn" data-hud-act="duplicate" data-step-id="' + escapeHtml(step.id) + '">Duplicar</button>' +
                  '<button type="button" class="aahud-menu-btn is-danger" data-hud-act="delete" data-step-id="' + escapeHtml(step.id) + '">Excluir</button>' +
                '</div>'
              : '') +
          '</div>'
        );
      })
      .join('');

    hud.innerHTML =
      '<div class="aahud-head" id="aahud-drag-handle">' +
        '<span class="aahud-head-title"><span class="aahud-dot"></span>' +
          (isList ? 'Assistente de Tabela' : 'Gravação na Tela') +
        '</span>' +
        '<span style="display:flex;align-items:center;gap:6px">' +
          '<span class="aahud-counter">' + recordedSteps.length + ' passo' + (recordedSteps.length === 1 ? '' : 's') + '</span>' +
          '<button type="button" class="aahud-mini" data-hud-act="minimize" title="Minimizar HUD">_</button>' +
        '</span>' +
      '</div>' +
      (options.isResumedAfterNavigation
        ? '<div class="aahud-alert" id="aahud-nav-alert">' +
            '<span>Página carregada — gravação mantida.</span>' +
            '<button type="button" class="aahud-mini" data-hud-act="dismiss-nav">✕</button>' +
          '</div>'
        : '') +
      '<div class="aahud-hint">' + phaseInstruction +
        (waitingForElementMode
          ? '<br><span style="color:#fbbf24"><strong>Aguardando:</strong> clique no elemento que deve ficar visível.</span>'
          : '') +
      '</div>' +
      '<div class="aahud-steps">' +
        (recordedSteps.length === 0
          ? '<div class="aahud-empty">Nenhum passo gravado ainda.<br>Clique nos elementos da página.</div>'
          : stepsHtml) +
      '</div>' +
      '<div class="aahud-actions">' +
        '<button type="button" class="aahud-btn is-wide" data-hud-act="toggle-pause">' +
          (isPaused ? '▶ Retomar' : '⏸ Pausar') +
        '</button>' +
        '<button type="button" class="aahud-btn" data-hud-act="add-delay">⏳ + Pausa</button>' +
        '<button type="button" class="aahud-btn" data-hud-act="add-nav">🔗 + Navegar</button>' +
        '<button type="button" class="aahud-btn" data-hud-act="wait-element">👁 + Esperar</button>' +
        '<button type="button" class="aahud-btn" data-hud-act="undo" ' + (recordedSteps.length === 0 ? 'disabled' : '') + '>↩ Desfazer</button>' +
      '</div>' +
      (isList && wizardPhase === 'return_action'
        ? '<button type="button" class="aahud-btn is-primary" data-hud-act="history-back">⬅ Voltar pelo histórico</button>'
        : '') +
      '<div style="display:flex;gap:8px;border-top:1px solid #334155;padding-top:8px">' +
        '<button type="button" class="aahud-btn is-primary" style="flex:2" data-hud-act="finish">💾 Salvar gravação</button>' +
        '<button type="button" class="aahud-btn is-danger" data-hud-act="cancel">Cancelar</button>' +
      '</div>';

    setupDraggable(hud);
  }

  function renderExecutionHUD(info) {
    ensureHudStyles();

    var hud = document.getElementById(EXEC_HUD_ID);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = EXEC_HUD_ID;
      hud.className = 'aahud-exec';
      hud.setAttribute('data-aahud', 'exec');
      (document.body || document.documentElement).appendChild(hud);
    }

    var total = Number(info.totalSteps) || 1;
    var current = Number(info.stepIndex) || 0;
    var percent = Math.max(4, Math.min(100, Math.round((current / total) * 100)));

    hud.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">' +
        '<strong style="font-size:11px;color:#93c5fd;text-transform:uppercase;letter-spacing:.04em">' +
          escapeHtml(info.taskName || 'Executando') +
        '</strong>' +
        '<span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(info.label || '') +
        '</span>' +
        '<div class="aahud-exec-bar"><div class="aahud-exec-fill" style="width:' + percent + '%"></div></div>' +
      '</div>' +
      '<span style="font-size:11px;color:#94a3b8">' + current + '/' + total + '</span>' +
      '<button type="button" class="aahud-btn is-danger" data-exec-act="abort">Parar</button>';

    if (!hud.getAttribute('data-bound')) {
      hud.setAttribute('data-bound', '1');
      hud.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.closest && target.closest('[data-exec-act="abort"]')) {
          event.preventDefault();
          isExecuting = false;
          sendLog('warn', 'Execução interrompida pelo usuário.');
          hud.remove();
        }
      });
    }
  }

  var dragState = { active: false, startX: 0, startY: 0, startRight: 0, startBottom: 0, hud: null };
  var dragListenersBound = false;

  // Listeners de arraste ficam no window e são registrados UMA vez; antes eram
  // recriados a cada render do HUD, acumulando dezenas de handlers globais.
  function ensureDragListeners() {
    if (dragListenersBound) return;
    dragListenersBound = true;

    window.addEventListener('mousemove', function (event) {
      if (!dragState.active || !dragState.hud) return;
      var dx = dragState.startX - event.clientX;
      var dy = dragState.startY - event.clientY;
      dragState.hud.style.right = Math.max(10, dragState.startRight + dx) + 'px';
      dragState.hud.style.bottom = Math.max(10, dragState.startBottom + dy) + 'px';
    });

    window.addEventListener('mouseup', function () {
      if (!dragState.active) return;
      dragState.active = false;
      dragState.hud = null;
      if (document.body) document.body.style.userSelect = '';
    });
  }

  function setupDraggable(hud) {
    var handle = hud.querySelector('#aahud-drag-handle');
    if (!handle) return;

    ensureDragListeners();

    handle.addEventListener('mousedown', function (event) {
      if (event.target && event.target.tagName === 'BUTTON') return;

      var rect = hud.getBoundingClientRect();
      dragState.active = true;
      dragState.hud = hud;
      dragState.startX = event.clientX;
      dragState.startY = event.clientY;
      dragState.startRight = window.innerWidth - rect.right;
      dragState.startBottom = window.innerHeight - rect.bottom;

      if (document.body) document.body.style.userSelect = 'none';
      event.preventDefault();
    });
  }

  function closeHUD() {
    var hud = document.getElementById(HUD_ID);
    if (hud) hud.remove();
  }

  function closeExecutionHUD() {
    var hud = document.getElementById(EXEC_HUD_ID);
    if (hud) hud.remove();
  }

  async function finishRecording() {
    var session = await safeStoreGet('rpaRecordingSession');
    var current = session.rpaRecordingSession || {};
    var targetTaskId = current.taskId || recordingTaskId;
    var steps = recordedSteps.slice();

    safeMessage({
      type: 'SAVE_RECORDED_STEPS',
      taskId: targetTaskId,
      steps: steps,
      listConfig: wizardListConfig,
    });

    closeHUD();
    sendLog('success', 'Gravação concluída: ' + steps.length + ' passos salvos.', 'completed');

    activeRecordingMode = null;
    wizardPhase = null;
    recordedSteps = [];
    openStepMenuId = null;
  }

  async function cancelRecording() {
    var confirmed = window.confirm(
      'Cancelar a gravação? Os passos ainda não salvos serão descartados.'
    );
    if (!confirmed) return;

    safeMessage({ type: 'CANCEL_RECORDING_SESSION' });
    activeRecordingMode = null;
    wizardPhase = null;
    recordedSteps = [];
    openStepMenuId = null;
    closeHUD();
    sendLog('warn', 'Gravação cancelada pelo usuário.');
  }

  // ==========================================
  // CAPTURA DO USUÁRIO (gravação)
  // ==========================================

  document.addEventListener(
    'click',
    function (event) {
      if (!activeRecordingMode || isPaused) return;
      if (isHudNode(event.target)) return;

      var rawTarget = event.target;
      if (!rawTarget || rawTarget.nodeType !== 1) return;

      var target = normalizeTargetForRecording(rawTarget);
      if (!target) return;

      var selector = getResilientSelector(target);
      var ariaSelector = getAriaSelector(target);
      var xpath = getXPath(target);
      var rect = target.getBoundingClientRect();
      var coords = {
        xPct: rect.width > 0 ? Number(((event.clientX - rect.left) / rect.width).toFixed(2)) : 0.5,
        yPct: rect.height > 0 ? Number(((event.clientY - rect.top) / rect.height).toFixed(2)) : 0.5,
      };

      if (waitingForElementMode) {
        event.preventDefault();
        event.stopPropagation();
        waitingForElementMode = false;

        addRecordedStep({
          id: 'step-' + Date.now(),
          order: recordedSteps.length + 1,
          label: getCleanLabel(target, 'wait_visible'),
          action: 'wait_visible',
          cssSelector: selector,
          ariaSelector: ariaSelector,
          xpath: xpath,
          waitBeforeMs: 300,
          timeoutMs: 15000,
          isLoopTarget: false,
          url: window.location.href,
        });

        highlightElement(target, '#facc15');
        return;
      }

      var isCombobox =
        target.getAttribute('role') === 'combobox' ||
        target.getAttribute('aria-haspopup') === 'listbox' ||
        target.getAttribute('aria-haspopup') === 'menu' ||
        target.getAttribute('aria-haspopup') === 'true' ||
        target.classList.contains('select__control') ||
        target.classList.contains('ant-select-selector') ||
        target.classList.contains('MuiSelect-select') ||
        target.classList.contains('headlessui-listbox-button') ||
        target.classList.contains('dropdown-toggle');

      var isOption =
        target.matches(OPTION_ROLE_SELECTOR) ||
        target.getAttribute('role') === 'option';

      var action = 'click';
      if (
        target.type === 'checkbox' ||
        target.type === 'radio' ||
        target.getAttribute('role') === 'checkbox' ||
        target.getAttribute('role') === 'switch'
      ) {
        action = 'check';
      } else if (target.tagName === 'SELECT') {
        action = 'select';
      }

      var label = getCleanLabel(
        target,
        isCombobox ? 'open_dropdown' : isOption ? 'choose_option' : action
      );

      var baseStep = {
        id: 'step-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        order: recordedSteps.length + 1,
        label: label,
        action: action,
        cssSelector: selector,
        ariaSelector: ariaSelector,
        xpath: xpath,
        coords: coords,
        isCombobox: isCombobox,
        isOption: isOption,
        optionText: isOption ? String(target.innerText || target.textContent || '').trim() : undefined,
        parentTriggerSelector: isOption ? lastTriggerSelector || undefined : undefined,
        role: target.getAttribute('role') || target.tagName.toLowerCase(),
        tagName: target.tagName,
        waitBeforeMs: 350,
        timeoutMs: isOption ? 6000 : 15000,
        isLoopTarget: false,
        url: window.location.href,
      };

      if (isCombobox) {
        lastTriggerSelector = selector;
      }

      if (activeRecordingMode === 'free') {
        highlightElement(target);
        addRecordedStep(baseStep);
        return;
      }

      if (activeRecordingMode === 'list_wizard') {
        if (wizardPhase === 'list_row') {
          wizardListConfig.openDetailSelector = selector;
          var row = target.closest('tr, li, .card, [data-id]');
          if (row) wizardListConfig.listRowSelector = getResilientSelector(row);
          wizardPhase = 'detail_steps';
          highlightElement(target);
          persistSessionState();
          sendLog('info', 'Fase 1 gravada: abertura do item (' + selector + ').');
          renderHUD();
          return;
        }

        if (wizardPhase === 'detail_steps') {
          baseStep.isLoopTarget = true;
          baseStep.timeoutMs = 10000;
          highlightElement(target);
          addRecordedStep(baseStep);
          return;
        }

        if (wizardPhase === 'return_action') {
          wizardListConfig.returnSelector = selector;
          wizardListConfig.returnMode = 'click_button';
          wizardPhase = 'next_page';
          highlightElement(target);
          persistSessionState();
          sendLog('info', 'Fase 3 gravada: retorno (' + selector + ').');
          renderHUD();
          return;
        }

        if (wizardPhase === 'next_page') {
          wizardListConfig.nextPageSelector = selector;
          wizardListConfig.paginationEnabled = true;
          highlightElement(target);
          sendLog('info', 'Fase 4 gravada: paginação (' + selector + ').');
          finishRecording();
        }
      }
    },
    true
  );

  document.addEventListener(
    'change',
    function (event) {
      if (!activeRecordingMode || isPaused) return;
      if (isHudNode(event.target)) return;

      var target = event.target;
      if (!target || target.nodeType !== 1) return;

      var isTextField =
        (target.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'file'].indexOf(target.type) < 0) ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      var isSelect = target.tagName === 'SELECT';

      if (!isTextField && !isSelect) return;

      var selector = getResilientSelector(target);
      var ariaSelector = getAriaSelector(target);
      var xpath = getXPath(target);

      // Atualiza o último passo equivalente em vez de duplicar a cada tecla/blur
      var lastIndex = recordedSteps.length - 1;
      var existing = lastIndex >= 0 ? recordedSteps[lastIndex] : null;

      if (
        existing &&
        (existing.action === 'fill' || existing.action === 'select') &&
        existing.cssSelector === selector
      ) {
        existing.value = isSelect ? target.value : target.value || target.textContent || '';
        persistSessionState();
        renderHUD();
        return;
      }

      var step = {
        id: 'step-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        order: recordedSteps.length + 1,
        label: getCleanLabel(target, isSelect ? 'select' : 'fill'),
        action: isSelect ? 'select' : 'fill',
        cssSelector: selector,
        ariaSelector: ariaSelector,
        xpath: xpath,
        value: isSelect ? target.value : target.value || target.textContent || '',
        waitBeforeMs: 250,
        timeoutMs: 8000,
        isLoopTarget: activeRecordingMode === 'list_wizard' && wizardPhase === 'detail_steps',
        url: window.location.href,
      };

      highlightElement(target);
      addRecordedStep(step);
    },
    true
  );

  window.addEventListener('beforeunload', function () {
    if (activeRecordingMode) {
      persistSessionState();
    }
  });

  // ==========================================
  // EXECUÇÃO
  // ==========================================

  function normalizeSettings(config) {
    var settings = config || {};
    return {
      baseDelayMs: Number(settings.baseDelayMs) || 450,
      randomJitterMs: Number(settings.randomJitterMs) || 200,
      maxRetries: Math.max(1, Number(settings.maxRetries) || 3),
      autoWait: settings.autoWaitEnabled !== false,
    };
  }

  function jitter(settings) {
    return Math.floor(Math.random() * Math.max(0, settings.randomJitterMs));
  }

  async function guardExecutionPause() {
    while (isPaused && isExecuting) {
      await sleep(250);
    }
  }

  async function runSingleStep(step, context) {
    if (!step) return;

    // Navegação programada: a página sai do ar, então persistimos e paramos.
    if (step.action === 'navigate' && step.value) {
      var targetUrl = String(step.value);
      if (window.location.href !== targetUrl) {
        sendLog('info', 'Navegando para ' + targetUrl + '...');
        window.location.href = targetUrl;
        return;
      }
      return;
    }

    if (step.action === 'sleep') {
      var waitMs = Number(step.value) || 2000;
      sendLog('info', 'Aguardando ' + (waitMs / 1000).toFixed(1) + 's conforme programado...');
      await sleep(waitMs);
      return;
    }

    if (step.action === 'wait_visible') {
      var visible = await findActionableElement(step, step.timeoutMs || 15000);
      highlightElement(visible, '#facc15');
      return;
    }

    // Opção de dropdown: caminho dedicado, com reabertura do menu se preciso.
    if (step.isOption || step.role === 'option' || (step.action === 'select' && step.isCombobox)) {
      await chooseOptionStep(step);
      return;
    }

    var element = await findActionableElement(step, step.timeoutMs || 15000);

    if (step.action === 'fill') {
      highlightElement(element, '#10b981');
      await performFill(element, step.value);
      return;
    }

    if (step.action === 'check') {
      var alreadyChecked =
        element.checked === true ||
        element.getAttribute('aria-checked') === 'true' ||
        element.getAttribute('data-state') === 'checked';

      if (!alreadyChecked) {
        await performClick(element, step);
      }
      return;
    }

    if (step.action === 'select') {
      if (element.tagName === 'SELECT') {
        highlightElement(element, '#10b981');
        await performNativeSelect(element, step.value);
      } else {
        await performClick(element, step);
      }
      return;
    }

    await performClick(element, step);
  }

  async function executeFreeMacroTask(task, config, startFromStepIdx, currentCycle) {
    if (!task || isExecuting) return;

    isExecuting = true;
    isPaused = false;

    var settings = normalizeSettings(config);
    var steps = Array.isArray(task.steps) ? task.steps : [];
    var repeatCount = task.repeatMode === 'repeat_n' ? Math.max(1, Number(task.repeatCount) || 1) : 1;
    var firstCycle = Math.max(1, Number(currentCycle) || 1);
    var startIndex = Math.max(0, Number(startFromStepIdx) || 0);

    sendLog(
      'info',
      'Iniciando "' + task.name + '" com ' + steps.length + ' passo(s) (ciclo ' + firstCycle + '/' + repeatCount + ').'
    );

    try {
      for (var cycle = firstCycle; cycle <= repeatCount; cycle += 1) {
        if (!isExecuting) break;

        var from = cycle === firstCycle ? startIndex : 0;

        for (var index = from; index < steps.length; index += 1) {
          if (!isExecuting) break;
          if (isPaused) await guardExecutionPause();
          if (!isExecuting) break;

          var step = steps[index];

          safeStoreSet({
            rpaExecutionSession: {
              active: true,
              taskId: task.id,
              cycle: cycle,
              repeatCount: repeatCount,
              nextStepIdx: index + 1,
              config: config,
            },
          });

          renderExecutionHUD({
            taskName: task.name,
            stepIndex: index + 1,
            totalSteps: steps.length,
            label: step.label,
          });

          await sleep(Math.max(80, Number(step.waitBeforeMs) || 250) + jitter(settings));

          try {
            await runSingleStep(step, { settings: settings, task: task });
            sendLog('success', 'Passo ' + (index + 1) + '/' + steps.length + ': ' + step.label);
            await waitForActionSettled(settings.baseDelayMs);
          } catch (stepError) {
            var message = stepError && stepError.message ? stepError.message : String(stepError);
            sendLog('warn', 'Passo ' + (index + 1) + ' (' + step.label + '): ' + message);
            await sleep(800);
          }
        }

        if (!isExecuting) break;

        if (cycle < repeatCount) {
          sendLog('info', 'Ciclo ' + cycle + ' concluído. Reiniciando...');
          await sleep(Math.max(400, settings.baseDelayMs));
        }
      }

      if (isExecuting) {
        safeStoreSet({ rpaExecutionSession: { active: false } });
        sendLog('success', 'Tarefa "' + task.name + '" finalizada com sucesso!', 'completed');
      }
    } catch (error) {
      var fatal = error && error.message ? error.message : String(error);
      sendLog('error', 'Falha na execução de "' + task.name + '": ' + fatal);
    } finally {
      isExecuting = false;
      isPaused = false;
      closeExecutionHUD();
      safeMessage({ type: 'UPDATE_STATS', patch: { status: 'idle' } });
    }
  }

  async function executeBatchTableWorkflow(task, config) {
    if (isExecuting) return;
    isExecuting = true;
    isPaused = false;

    var settings = normalizeSettings(config);
    var listConfig = task.listConfig || {};
    var rowSelector = listConfig.listRowSelector || 'table tbody tr';
    var openDetailSelector = listConfig.openDetailSelector || null;
    var returnSelector = listConfig.returnSelector || null;
    var returnMode = listConfig.returnMode || 'click_button';
    var nextPageSelector = listConfig.nextPageSelector || null;
    var paginationEnabled = Boolean(listConfig.paginationEnabled);
    var detailSteps = (task.steps || []).filter(function (step) {
      return step.isLoopTarget;
    });

    var approved = 0;
    var page = 1;

    sendLog('info', 'Iniciando processamento em lote com auto-wait...');

    try {
      while (isExecuting) {
        if (isPaused) await guardExecutionPause();
        await waitForActionSettled(500);

        var rows = Array.prototype.slice
          .call(document.querySelectorAll(rowSelector))
          .filter(function (row) {
            var text = normalizeText(row.innerText);
            return !/aprovado|rejeitado|conclu[ií]do|cancelado/.test(text);
          });

        if (rows.length === 0) {
          if (paginationEnabled && nextPageSelector) {
            var nextButton = document.querySelector(nextPageSelector);
            if (nextButton && isElementActionable(nextButton)) {
              sendLog('info', 'Avançando para a página ' + (page + 1) + '...');
              await performClick(nextButton, {});
              page += 1;
              await waitForActionSettled(settings.baseDelayMs);
              continue;
            }
          }
          sendLog('success', 'Processamento finalizado: ' + approved + ' item(ns).');
          break;
        }

        for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (!isExecuting) break;

          var row = rows[rowIndex];
          var itemId =
            row.getAttribute('data-id') ||
            (row.querySelector('strong, .protocolo-id') || {}).innerText ||
            'item ' + (rowIndex + 1);

          for (var attempt = 1; attempt <= settings.maxRetries; attempt += 1) {
            try {
              try {
                row.scrollIntoView({ block: 'center', behavior: 'smooth' });
              } catch (scrollError) {
                /* ignore */
              }
              highlightElement(row);
              await sleep(settings.baseDelayMs + jitter(settings));

              var openButton =
                (openDetailSelector ? row.querySelector(openDetailSelector) : null) ||
                row.querySelector('button, a') ||
                row;

              await performClick(openButton, {});
              await waitForActionSettled(500);

              for (var detailIndex = 0; detailIndex < detailSteps.length; detailIndex += 1) {
                if (!isExecuting) return;
                var detailStep = detailSteps[detailIndex];

                renderExecutionHUD({
                  taskName: task.name,
                  stepIndex: detailIndex + 1,
                  totalSteps: detailSteps.length,
                  label: detailStep.label,
                });

                await sleep((Number(detailStep.waitBeforeMs) || 250) + jitter(settings));
                await runSingleStep(detailStep, { settings: settings, task: task });
                await waitForActionSettled(settings.baseDelayMs);
              }

              await sleep(350);
              if (returnMode === 'history_back') {
                window.history.back();
              } else {
                var backButton = returnSelector ? document.querySelector(returnSelector) : null;
                if (!backButton) {
                  backButton = document.querySelector(
                    'button#btn-cancelar-aprovacao, button.btn-voltar, [data-action="close-modal"], .modal button[aria-label="Fechar"]'
                  );
                }
                if (backButton && isElementActionable(backButton)) {
                  await performClick(backButton, {});
                }
              }

              await waitForActionSettled(500);

              approved += 1;
              sendLog('success', itemId + ' processado com sucesso (' + approved + ').', 'approved');
              safeMessage({ type: 'UPDATE_STATS', patch: { approved: approved, currentPage: page } });
              break;
            } catch (error) {
              var message = error && error.message ? error.message : String(error);
              sendLog('warn', 'Tentativa ' + attempt + ' falhou para ' + itemId + ': ' + message);
              if (attempt >= settings.maxRetries) {
                sendLog('error', 'Falha definitiva ao processar ' + itemId + '.');
              }
              await sleep(800);
            }
          }
        }
      }
    } finally {
      isExecuting = false;
      closeExecutionHUD();
    }
  }

  // ==========================================
  // RESTAURAÇÃO ENTRE PÁGINAS
  // ==========================================

  async function checkAndResumeState() {
    try {
      var stored = await safeStoreGet(['rpaRecordingSession', 'rpaExecutionSession', 'rpaTasks']);
      var recording = stored.rpaRecordingSession || {};
      var execution = stored.rpaExecutionSession || {};
      var tasks = Array.isArray(stored.rpaTasks) ? stored.rpaTasks : [];

      if (recording.active) {
        activeRecordingMode = recording.mode || 'free';
        wizardPhase = recording.wizardPhase || null;
        wizardListConfig = recording.wizardListConfig || wizardListConfig;
        recordedSteps = Array.isArray(recording.recordedSteps) ? recording.recordedSteps : [];
        hudMinimized = Boolean(recording.hudMinimized);
        isPaused = recording.status === 'paused';
        recordingTaskId = recording.taskId || null;

        var navigated = Boolean(recording.lastUrl) && recording.lastUrl !== window.location.href;

        if (navigated) {
          recordedSteps.push({
            id: 'step-nav-' + Date.now(),
            order: recordedSteps.length + 1,
            label: 'Aguardar carregamento da página',
            action: 'wait_visible',
            cssSelector: 'body',
            waitBeforeMs: 600,
            timeoutMs: 20000,
            isLoopTarget: false,
            url: window.location.href,
          });
          renumberSteps();
          persistSessionState();
        }

        renderHUD({ isResumedAfterNavigation: navigated });
        sendLog('info', 'Sessão de gravação restaurada em ' + window.location.pathname);
      }

      if (execution.active) {
        var taskId = execution.taskId;
        var activeTask = tasks.filter(function (item) {
          return item.id === taskId;
        })[0];

        if (activeTask && Number(execution.nextStepIdx) < (activeTask.steps || []).length) {
          sendLog(
            'info',
            'Retomando "' + activeTask.name + '" no passo ' + (Number(execution.nextStepIdx) + 1) + ' após navegação...'
          );
          await waitForActionSettled(800);
          executeFreeMacroTask(activeTask, execution.config, execution.nextStepIdx, execution.cycle || 1);
        } else {
          safeStoreSet({ rpaExecutionSession: { active: false } });
        }
      }
    } catch (error) {
      console.warn('[AutoApprove] Falha ao restaurar estado:', error);
    }
  }

  // ==========================================
  // MENSAGENS DO SERVICE WORKER / SIDE PANEL
  // ==========================================

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: 'Mensagem inválida.' });
      return false;
    }

    if (message.type === 'RPA_EXECUTE_TASK') {
      var task = message.task;
      var config = message.config || {};
      var pattern = task && task.pattern;

      if (pattern === 'list_detail_pagination' || pattern === 'list_batch') {
        executeBatchTableWorkflow(task, config);
      } else {
        executeFreeMacroTask(task, config, message.startStepIdx, 1);
      }

      sendResponse({ ok: true, executing: true });
      return true;
    }

    if (message.type === 'RPA_ABORT') {
      isExecuting = false;
      isPaused = false;
      closeExecutionHUD();
      sendLog('warn', 'Execução interrompida pelo painel.');
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'RPA_PAUSE') {
      isPaused = true;
      sendLog('info', 'Execução pausada.');
      sendResponse({ ok: true, paused: true });
      return true;
    }

    if (message.type === 'RPA_RESUME') {
      isPaused = false;
      sendLog('info', 'Execução retomada.');
      sendResponse({ ok: true, paused: false });
      return true;
    }

    if (message.type === 'RPA_START_RECORDING') {
      activeRecordingMode = message.mode || 'free';
      wizardPhase = message.mode === 'list_wizard' ? 'list_row' : null;
      recordedSteps = [];
      hudMinimized = false;
      isPaused = false;
      openStepMenuId = null;
      recordingTaskId = message.taskId || null;
      lastTriggerSelector = null;
      renderHUD();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'RPA_RESUME_RECORDING') {
      var session = message.session || {};
      activeRecordingMode = session.mode || 'free';
      wizardPhase = session.wizardPhase || null;
      wizardListConfig = session.wizardListConfig || wizardListConfig;
      recordedSteps = Array.isArray(session.recordedSteps) ? session.recordedSteps : [];
      hudMinimized = Boolean(session.hudMinimized);
      isPaused = session.status === 'paused';
      recordingTaskId = session.taskId || null;
      renderHUD({ isResumedAfterNavigation: true });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'RPA_PING') {
      sendResponse({
        ok: true,
        recording: Boolean(activeRecordingMode),
        executing: isExecuting,
        paused: isPaused,
        steps: recordedSteps.length,
      });
      return true;
    }

    sendResponse({ ok: false, error: 'Tipo de mensagem desconhecido: ' + message.type });
    return true;
  });

  // Inicializa restauração de sessão
  checkAndResumeState();
})();
