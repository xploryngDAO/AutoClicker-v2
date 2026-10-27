import {
  BACKGROUND_JS,
  POPUP_HTML,
  POPUP_JS,
  SIDEPANEL_CSS,
  SIDEPANEL_HTML,
  SIDEPANEL_JS,
} from './generated/templateStrings.ts';

export { generateContentJs } from './contentScriptTemplate.ts';

/**
 * Templates da extensão.
 *
 * O HTML/CSS/JS real está em `src/lib/templates/` e é embutido em
 * `src/lib/generated/templateStrings.ts` por `scripts/build-templates.mjs`
 * (`npm run gen`). O gerador compila cada script com o V8 antes de embutir,
 * então um erro de sintaxe trava o build em vez de gerar uma extensão morta.
 */

const EXTENSION_VERSION = '3.1.0';

export function generateExtensionManifest(): string {
  const manifest = {
    manifest_version: 3,
    name: 'AutoApprove RPA Universal (Qualquer Tarefa & Lotes)',
    version: EXTENSION_VERSION,
    description:
      'Motor universal de RPA e macros: grava qualquer clique, digitação e seleção de dropdown na tela e executa lotes com paginação na sessão já autenticada.',
    permissions: [
      'storage',
      'tabs',
      'scripting',
      'alarms',
      'sidePanel',
      'notifications',
      'activeTab',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {
      default_title: 'Abrir AutoApprove RPA',
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icon16.png',
        '48': 'icon48.png',
        '128': 'icon128.png',
      },
    },
    icons: {
      '16': 'icon16.png',
      '48': 'icon48.png',
      '128': 'icon128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
  };

  return JSON.stringify(manifest, null, 2);
}

/** Service worker com as tarefas e a configuração padrão injetadas. */
export function generateBackgroundJs(tasks: unknown, config: unknown): string {
  const tasksJson = JSON.stringify(Array.isArray(tasks) ? tasks : []);
  const configJson = JSON.stringify(config && typeof config === 'object' ? config : {});

  return BACKGROUND_JS.replace('__DEFAULT_TASKS_JSON__', () => tasksJson).replace(
    '__DEFAULT_CONFIG_JSON__',
    () => configJson
  );
}

export function generateSidepanelHtml(): string {
  return SIDEPANEL_HTML;
}

export function generateSidepanelCss(): string {
  return SIDEPANEL_CSS;
}

export function generateSidepanelJs(): string {
  return SIDEPANEL_JS;
}

export function generatePopupHtml(): string {
  return POPUP_HTML;
}

export function generatePopupJs(): string {
  return POPUP_JS;
}
