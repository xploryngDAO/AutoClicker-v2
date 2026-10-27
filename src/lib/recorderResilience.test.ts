import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateExtensionManifest,
  generateBackgroundJs,
  generateContentJs,
  generateSidepanelHtml,
} from './extensionTemplates.ts';
import { buildChromeExtensionZipEntries } from './codeGenerators.ts';
import { getDefaultConfig, getDefaultTasks, getDefaultWorkflowSteps } from './seedData.ts';
import { createZipArchive } from './zipBuilder.ts';

test('manifest.json includes webNavigation and essential MV3 permissions', () => {
  const manifestStr = generateExtensionManifest();
  const manifest = JSON.parse(manifestStr);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('webNavigation'), 'Missing webNavigation permission');
  assert.ok(manifest.permissions.includes('storage'), 'Missing storage permission');
  assert.ok(manifest.permissions.includes('tabs'), 'Missing tabs permission');
  assert.ok(manifest.permissions.includes('scripting'), 'Missing scripting permission');
  assert.ok(manifest.content_scripts[0].matches.includes('<all_urls>'));
});

test('content.js embeds persistent multi-page session restoration and resilient selectors', () => {
  const contentJs = generateContentJs();
  // Verifies restoration logic on page navigation
  assert.ok(contentJs.includes('checkAndResumeState') || contentJs.includes('checkAndResumeRecording'), 'Missing checkAndResumeState function');
  assert.ok(contentJs.includes('rpaRecordingSession'), 'Missing rpaRecordingSession storage key');
  assert.ok(contentJs.includes('persistSessionState'), 'Missing persistSessionState immediate write');
  assert.ok(contentJs.includes('setupDraggable'), 'Missing draggable HUD setup');
  assert.ok(contentJs.includes('hudMinimized'), 'Missing HUD minimize toggle');
  assert.ok(contentJs.includes('getResilientSelector'), 'Missing getResilientSelector');
  assert.ok(contentJs.includes('getXPath'), 'Missing getXPath fallback');
  assert.ok(contentJs.includes('getAriaSelector'), 'Missing getAriaSelector');
  assert.ok(contentJs.includes('beforeunload'), 'Missing beforeunload flush listener');
});

test('content.js includes dynamic auto-wait, action-settled engine, and actionable element detection', () => {
  const contentJs = generateContentJs();
  assert.ok(contentJs.includes('waitForActionSettled'), 'Missing waitForActionSettled engine');
  assert.ok(contentJs.includes('waitForBlockersToVanish'), 'Missing waitForBlockersToVanish (spinners, loaders, modals)');
  assert.ok(contentJs.includes('waitForDomMutationQuiet'), 'Missing waitForDomMutationQuiet mutation settling');
  assert.ok(contentJs.includes('isElementActionable'), 'Missing isElementActionable check');
  assert.ok(contentJs.includes('findActionableElement'), 'Missing findActionableElement fallback locator');
  assert.ok(contentJs.includes('rpaExecutionSession'), 'Missing rpaExecutionSession multi-page task resume');
});

test('background.js tracks active recording session and handles tab reloads', () => {
  const bgJs = generateBackgroundJs(getDefaultTasks(), getDefaultConfig() as unknown as Record<string, unknown>);
  assert.ok(bgJs.includes('chrome.tabs.onUpdated.addListener'), 'Missing tabs.onUpdated listener');
  assert.ok(bgJs.includes('RPA_RESUME_RECORDING'), 'Missing RPA_RESUME_RECORDING dispatch');
  assert.ok(bgJs.includes('rpaRecordingSession'), 'Missing rpaRecordingSession in background');
  assert.ok(bgJs.includes('START_RECORDING_WIZARD'), 'Missing START_RECORDING_WIZARD handler');
  assert.ok(bgJs.includes('SYNC_RECORDING_STEP'), 'Missing SYNC_RECORDING_STEP handler');
});

test('sidepanel.html includes live multi-page recording banner and resilience info', () => {
  const html = generateSidepanelHtml();
  assert.ok(html.includes('live-recording-banner'), 'Missing live recording banner in sidepanel');
  assert.ok(html.includes('Gravação Blindada Multi-Páginas'), 'Missing multi-page resilience info box');
  assert.ok(html.includes('data-speed="adaptive"'), 'Missing adaptive auto-wait speed option');
});

test('Chrome Extension ZIP builder bundles the enhanced multi-page recorder files', () => {
  const config = getDefaultConfig();
  const steps = getDefaultWorkflowSteps();
  const entries = buildChromeExtensionZipEntries(config, steps);

  const manifestEntry = entries.find((e) => e.path === 'manifest.json');
  const contentEntry = entries.find((e) => e.path === 'content.js');
  const bgEntry = entries.find((e) => e.path === 'background.js');

  assert.ok(manifestEntry, 'manifest.json missing in zip entries');
  assert.ok(contentEntry, 'content.js missing in zip entries');
  assert.ok(bgEntry, 'background.js missing in zip entries');

  const contentStr = typeof contentEntry.content === 'string'
    ? contentEntry.content
    : new TextDecoder().decode(contentEntry.content);
  assert.ok(contentStr.includes('checkAndResumeState') || contentStr.includes('checkAndResumeRecording'), 'content.js inside ZIP lacks multi-page resumption');
  assert.ok(contentStr.includes('waitForActionSettled'), 'content.js inside ZIP lacks waitForActionSettled');

  const zipBytes = createZipArchive(entries);
  assert.ok(zipBytes.length > 50000, 'Zip archive is smaller than expected');
  // Check PK magic header
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
});

test('content.js implements universal dropdown, combobox and custom element execution engine', () => {
  const contentJs = generateContentJs();

  // 1. PointerEvent and Coordinate Precision
  assert.ok(contentJs.includes('PointerEvent'), 'Missing PointerEvent support in performClick');
  assert.ok(contentJs.includes("pointerType: 'mouse'"), 'Missing pointerType: mouse specification');
  assert.ok(contentJs.includes('clientX') && contentJs.includes('clientY'), 'Missing clientX/clientY coordinate calculation');

  // 2. Target Normalization (resolves inner icon/span vs outer trigger)
  assert.ok(contentJs.includes('normalizeTargetForRecording'), 'Missing normalizeTargetForRecording');
  assert.ok(contentJs.includes('resolveInteractiveTarget'), 'Missing resolveInteractiveTarget');

  // 3. Dropdown & Combobox Detection
  assert.ok(contentJs.includes('isCombobox'), 'Missing isCombobox detection');
  assert.ok(contentJs.includes('isOption'), 'Missing isOption detection');
  assert.ok(contentJs.includes('showPicker'), 'Missing HTMLSelectElement showPicker support');

  // 4. WAI-ARIA Combobox Keyboard Fallback (ArrowDown / Space)
  assert.ok(contentJs.includes('ArrowDown'), 'Missing ArrowDown keyboard trigger for comboboxes');
  assert.ok(contentJs.includes('aria-expanded'), 'Missing aria-expanded verification');

  // 5. Open Dropdown Portal / Menu Search
  assert.ok(contentJs.includes('role="listbox"') || contentJs.includes('role=\\"listbox\\"'), 'Missing listbox portal search');
  assert.ok(contentJs.includes('HTMLInputElement.prototype'), 'Missing React native input tracker value setter');
});

test('dropdown activation happens once, without the double click that closed the menu', () => {
  const contentJs = generateContentJs();

  // A ativação passa por um único caminho (clickOnce) — nunca dispara
  // dispatchEvent('click') e element.click() para o mesmo elemento.
  assert.ok(contentJs.includes('function clickOnce'), 'Missing single-activation helper');
  assert.equal(
    (contentJs.match(/\.click\(\)/g) || []).length,
    1,
    'Deve existir um único ponto de clique nativo no content script'
  );

  // O menu é aberto por verificação de estado, com reabertura pelo gatilho.
  assert.ok(contentJs.includes('ensureDropdownOpen'), 'Missing ensureDropdownOpen');
  assert.ok(contentJs.includes('isDropdownExpanded'), 'Missing dropdown state verification');
  assert.ok(contentJs.includes('findOpenMenu'), 'Missing open menu discovery');
  assert.ok(contentJs.includes('chooseOptionStep'), 'Missing option selection step');
  assert.ok(contentJs.includes('parentTriggerSelector'), 'Missing recorded trigger reference for options');
});

test('content.js exposes per-step action menu with +2s wait insertion', () => {
  const contentJs = generateContentJs();

  assert.ok(contentJs.includes('data-hud-act="delay-2"'), 'Missing +2s button in recording HUD');
  assert.ok(contentJs.includes('makeDelayStep'), 'Missing delay step factory');
  assert.ok(contentJs.includes('insertStepAfter'), 'Missing step insertion helper');
  assert.ok(contentJs.includes("action === 'sleep'"), 'Missing sleep step handling during execution');
  assert.ok(contentJs.includes('aahud-step-menu'), 'Missing per-step action menu markup');
});
