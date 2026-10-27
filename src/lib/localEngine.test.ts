import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProxy,
  checkProxy,
  deleteProxy,
  getLocalSnapshot,
  importQueue,
  patchProxy,
  pauseRun,
  resetQueue,
  resolveChallenge,
  stopRun,
  triggerChallenge,
  updateConfig,
  updateSteps,
} from './localEngine.ts';

/**
 * O motor local é o que faz o site publicado funcionar sem servidor. Ele roda
 * uma máquina de estados real (timers, retries, challenge, logs), então vale
 * exercitar o ciclo completo — não só as funções puras.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(40);
  }
  throw new Error('Tempo esgotado esperando a condição do motor local.');
}

test('estado inicial traz a fila completa e as métricas coerentes', () => {
  const snapshot = getLocalSnapshot();

  assert.equal(snapshot.queue.length, 418);
  assert.equal(snapshot.metrics.total, 418);
  assert.equal(snapshot.metrics.pending, 418);
  assert.equal(snapshot.engineStatus === 'idle' || snapshot.engineStatus === 'running', true);
  assert.ok(snapshot.steps.length > 0, 'Passos padrão ausentes');
  assert.ok(snapshot.proxies.length > 0, 'Proxies padrão ausentes');
});

test('configuração, passos, proxies e importação de CSV alteram o estado', () => {
  const configResult = updateConfig({ baseDelayMs: 40, randomJitterMs: 20, maxRetries: 2 });
  assert.equal(configResult.ok, true);
  assert.equal(getLocalSnapshot().config.baseDelayMs, 40);

  const emptyUrl = updateConfig({ targetPortalUrl: '   ' });
  assert.equal(emptyUrl.ok, false, 'URL vazia deve ser rejeitada');

  const stepsResult = updateSteps([
    {
      id: 's1',
      order: 1,
      label: 'Clicar em Aprovar',
      action: 'click',
      cssSelector: 'button[data-action="approve"]',
      ariaSelector: '',
      waitBeforeMs: 50,
      timeoutMs: 2000,
      isLoopTarget: false,
    },
  ] as never);
  assert.equal(stepsResult.ok, true);
  assert.equal(getLocalSnapshot().steps.length, 1);

  const proxyResult = addProxy({ label: 'Proxy Teste', host: '10.0.0.1', port: 8080 });
  assert.equal(proxyResult.ok, true);
  const proxyId = proxyResult.proxy!.id;

  assert.equal(patchProxy(proxyId, { enabled: false }).ok, true);
  assert.equal(getLocalSnapshot().proxies.find((p) => p.id === proxyId)?.enabled, false);

  assert.equal(checkProxy(proxyId).ok, true);
  assert.equal(deleteProxy(proxyId).ok, true);
  assert.equal(getLocalSnapshot().proxies.some((p) => p.id === proxyId), false);

  const before = getLocalSnapshot().queue.length;
  const importResult = importQueue('IMP-1;Fulano;fulano@corp.com;SAP;Acesso Total');
  assert.equal(importResult.ok, true);
  assert.equal(getLocalSnapshot().queue.length, before + 1);
});

test('execução local aprova itens, registra logs e pode ser pausada', async () => {
  resetQueue(12);
  updateConfig({ batchSpeedMultiplier: 8, baseDelayMs: 30, randomJitterMs: 20, maxRetries: 1 });

  const started = getLocalSnapshot();
  assert.equal(started.queue.length, 12);
  assert.equal(started.metrics.pending, 12);

  // Espelha o botão "Iniciar"
  const { startRun } = await import('./localEngine.ts');
  const start = startRun();
  assert.equal(start.ok, true);
  assert.equal(getLocalSnapshot().engineStatus, 'running');

  await waitFor(() => getLocalSnapshot().metrics.approved >= 2, 10000);

  const running = getLocalSnapshot();
  assert.ok(running.metrics.approved >= 2, 'Nenhum item foi aprovado pelo motor local');
  assert.ok(running.logs.length > 1, 'O motor não gerou logs');
  assert.ok(
    running.logs.some((entry) => /aprovado com sucesso/i.test(entry.message)),
    'Log de aprovação ausente'
  );

  pauseRun();
  assert.equal(getLocalSnapshot().engineStatus, 'paused');

  stopRun();
  const stopped = getLocalSnapshot();
  assert.equal(stopped.engineStatus, 'idle');
  assert.equal(
    stopped.queue.some((item) => item.status === 'running'),
    false,
    'Parar deve devolver itens em execução para pendente'
  );
});

test('desafio de MFA pausa a execução e é liberado pelo painel', async () => {
  resetQueue(10);
  updateConfig({ batchSpeedMultiplier: 8, baseDelayMs: 20, randomJitterMs: 10 });
  stopRun();

  const triggered = triggerChallenge();
  assert.equal(triggered.ok, true);

  const awaiting = getLocalSnapshot();
  assert.equal(awaiting.engineStatus, 'awaiting_challenge');
  assert.ok(awaiting.activeChallenge, 'Desafio ativo não foi criado');
  assert.equal(awaiting.queue.find((i) => i.id === awaiting.activeChallenge!.requestId)?.status, 'challenge');

  resolveChallenge();
  const resumed = getLocalSnapshot();
  assert.equal(resumed.engineStatus, 'running');
  assert.equal(resumed.activeChallenge, null);

  stopRun();
  assert.equal(getLocalSnapshot().engineStatus, 'idle');
});
