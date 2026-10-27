import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOTAL_QUEUE_COUNT,
  computeQueueMetrics,
  filterQueueItems,
  generateInitialQueue,
  getDefaultConfig,
  getDefaultProxies,
  getDefaultWorkflowSteps,
  synthesizeRecordedStep,
} from './seedData';
import {
  buildChromeExtensionZipEntries,
  generateChromeExtensionTextFiles,
  generatePlaywrightScript,
  generateSeleniumScript,
  serializeAuditCsv,
} from './codeGenerators';
import { createExtensionIconPng, createZipArchive } from './zipBuilder';

test('generateInitialQueue creates 418 deterministic pending access requests', () => {
  const queue = generateInitialQueue();
  assert.equal(queue.length, DEFAULT_TOTAL_QUEUE_COUNT);
  assert.equal(queue[0].id, 'IAM-2026-0001');
  assert.equal(queue[417].id, 'IAM-2026-0418');
  assert.ok(queue.every((item) => item.status === 'pending'));

  const metrics = computeQueueMetrics(queue);
  assert.equal(metrics.total, 418);
  assert.equal(metrics.pending, 418);
  assert.equal(metrics.approved, 0);
  assert.equal(metrics.completionPercent, 0);
});

test('computeQueueMetrics and filterQueueItems calculate exact counts and search matches', () => {
  const queue = generateInitialQueue(10);
  queue[0].status = 'approved';
  queue[0].durationMs = 1200;
  queue[1].status = 'approved';
  queue[1].durationMs = 1400;
  queue[2].status = 'failed';
  queue[3].status = 'retrying';

  const metrics = computeQueueMetrics(queue);
  assert.equal(metrics.approved, 2);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.retrying, 1);
  assert.equal(metrics.pending, 6);
  assert.equal(metrics.avgDurationMs, 1300);
  assert.equal(metrics.completionPercent, 20);

  const approvedOnly = filterQueueItems(queue, 'approved', '');
  assert.equal(approvedOnly.length, 2);

  const byId = filterQueueItems(queue, 'all', 'IAM-2026-0003');
  assert.equal(byId.length, 1);
  assert.equal(byId[0].status, 'failed');
});

test('synthesizeRecordedStep converts 1st-round DOM interaction into resilient selector', () => {
  const step = synthesizeRecordedStep(
    {
      label: 'Aprovar Concessão',
      action: 'click',
      tagName: 'BUTTON',
      dataAction: 'approve-access',
      ariaLabel: 'Aprovar Concessão',
      elapsedSincePrevMs: 410,
    },
    4
  );

  assert.equal(step.order, 4);
  assert.equal(step.cssSelector, 'button[data-action="approve-access"]');
  assert.equal(step.ariaSelector, 'role=button[name="Aprovar Concessão"]');
  assert.equal(step.waitBeforeMs, 410);
});

test('Playwright and Selenium generators embed modeled steps, OAuth profile, and proxies', () => {
  const config = getDefaultConfig();
  const steps = getDefaultWorkflowSteps();
  const proxies = getDefaultProxies();

  const pwCode = generatePlaywrightScript(config, steps, proxies);
  assert.ok(pwCode.includes('launch_persistent_context'));
  assert.ok(pwCode.includes(config.targetPortalUrl));
  assert.ok(pwCode.includes('button[data-action="approve-access"]'));
  assert.ok(pwCode.includes('login.microsoftonline.com'));

  const selCode = generateSeleniumScript(config, steps, proxies);
  assert.ok(selCode.includes('WebDriverWait'));
  assert.ok(selCode.includes('--user-data-dir='));
  assert.ok(selCode.includes('button[data-action="approve-access"]'));
});

test('Chrome Extension MV3 generator and ZIP builder produce valid manifest, PNGs, and PKZIP archive', () => {
  const config = getDefaultConfig();
  const steps = getDefaultWorkflowSteps();

  const files = generateChromeExtensionTextFiles(config, steps);
  const manifestFile = files.find((f) => f.filename === 'manifest.json');
  assert.ok(manifestFile);

  const parsedManifest = JSON.parse(manifestFile.content);
  assert.equal(parsedManifest.manifest_version, 3);
  assert.equal(parsedManifest.background.service_worker, 'background.js');
  assert.ok(parsedManifest.permissions.includes('alarms'));
  assert.ok(parsedManifest.permissions.includes('sidePanel'));

  const png16 = createExtensionIconPng(16);
  // PNG 8-byte signature: 137 80 78 71 13 10 26 10
  assert.deepEqual(Array.from(png16.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

  const entries = buildChromeExtensionZipEntries(config, steps);
  const zipBytes = createZipArchive(entries);
  // PKZIP local file header signature 0x04034b50 -> [0x50, 0x4b, 0x03, 0x04]
  assert.deepEqual(Array.from(zipBytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  // End of central directory signature 0x06054b50 at offset zipBytes.length - 22
  const eocdOffset = zipBytes.length - 22;
  assert.deepEqual(Array.from(zipBytes.slice(eocdOffset, eocdOffset + 4)), [0x50, 0x4b, 0x05, 0x06]);
});

test('serializeAuditCsv formats header and escapes commas properly', () => {
  const queue = generateInitialQueue(2);
  queue[0].status = 'approved';
  queue[0].errorMessage = 'Aviso: latência alta, recuperado na 2ª tentativa';

  const csv = serializeAuditCsv(queue);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('id_solicitacao,colaborador,email'));
  assert.ok(lines[1].includes('"Aviso: latência alta, recuperado na 2ª tentativa"'));
});
