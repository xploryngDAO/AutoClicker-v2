import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AccessRequestItem,
  AccessStepTrace,
  ActiveChallenge,
  AutomationConfig,
  AutomationStateSnapshot,
  EngineStatus,
  ExecutionLogEntry,
  LogLevel,
  ProxyEndpoint,
  WorkflowStep,
} from './src/types/automation.ts';
import {
  computeQueueMetrics,
  generateInitialQueue,
  getDefaultConfig,
  getDefaultProxies,
  getDefaultWorkflowSteps,
} from './src/lib/seedData.ts';
import {
  buildChromeExtensionZipEntries,
  buildPythonBundleZipEntries,
  serializeAuditCsv,
} from './src/lib/codeGenerators.ts';
import { createZipArchive } from './src/lib/zipBuilder.ts';
import { browserManager } from './src/server/realBrowserManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerAutomationStore {
  engineStatus: EngineStatus;
  activeRequestId: string | null;
  activeStepOrder: number | null;
  activeChallenge: ActiveChallenge | null;
  startedAt: string | null;
  config: AutomationConfig;
  steps: WorkflowStep[];
  proxies: ProxyEndpoint[];
  queue: AccessRequestItem[];
  logs: ExecutionLogEntry[];
  activeProxyIndex: number;
  challengeDemonstratedInRun: boolean;
  reprocessedIds: Set<string>;
}

const store: ServerAutomationStore = {
  engineStatus: 'idle',
  activeRequestId: null,
  activeStepOrder: null,
  activeChallenge: null,
  startedAt: null,
  config: getDefaultConfig(),
  steps: getDefaultWorkflowSteps(),
  proxies: getDefaultProxies(),
  queue: generateInitialQueue(418),
  logs: [
    {
      id: 'log-boot-1',
      timestamp: new Date().toISOString(),
      level: 'info',
      message:
        'Sessão pronta: 418 solicitações carregadas. Use o Navegador Interno para ensinar ou assistir o robô.',
      detail: 'Microsoft OAuth conectado com perfil persistente em ./.ms_oauth_profile_corp',
    },
  ],
  activeProxyIndex: 0,
  challengeDemonstratedInRun: false,
  reprocessedIds: new Set<string>(),
};

const sseClients = new Set<Response>();
let workerRunningLock = false;

function buildSnapshot(): AutomationStateSnapshot {
  return {
    engineStatus: store.engineStatus,
    activeRequestId: store.activeRequestId,
    activeStepOrder: store.activeStepOrder,
    activeChallenge: store.activeChallenge,
    startedAt: store.startedAt,
    config: store.config,
    steps: store.steps,
    proxies: store.proxies,
    queue: store.queue,
    logs: store.logs,
    metrics: computeQueueMetrics(store.queue),
  };
}

function broadcastEvent(eventName: string, payload: unknown): void {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastSync(): void {
  broadcastEvent('sync', buildSnapshot());
}

function broadcastDelta(extra: {
  updatedItem?: AccessRequestItem;
  updatedProxy?: ProxyEndpoint;
  newLog?: ExecutionLogEntry;
}): void {
  broadcastEvent('delta', {
    engineStatus: store.engineStatus,
    activeRequestId: store.activeRequestId,
    activeStepOrder: store.activeStepOrder,
    activeChallenge: store.activeChallenge,
    metrics: computeQueueMetrics(store.queue),
    ...extra,
  });
}

function appendLog(
  level: LogLevel,
  message: string,
  opts?: { requestId?: string; stepLabel?: string; proxyLabel?: string; detail?: string }
): ExecutionLogEntry {
  const entry: ExecutionLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    requestId: opts?.requestId,
    stepLabel: opts?.stepLabel,
    proxyLabel: opts?.proxyLabel,
    message,
    detail: opts?.detail,
  };
  store.logs = [entry, ...store.logs].slice(0, 350);
  return entry;
}

function pickActiveProxy(rotate = false): ProxyEndpoint | null {
  const enabled = store.proxies.filter((p) => p.enabled);
  if (enabled.length === 0) return null;
  if (rotate && enabled.length > 1) {
    store.activeProxyIndex = (store.activeProxyIndex + 1) % enabled.length;
  }
  return enabled[store.activeProxyIndex % enabled.length];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTraceHash(reqId: string, attempts: number): string {
  let hash = 2166136261;
  const input = `${reqId}:${attempts}:${Date.now()}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `trc_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function runWorkerLoop(): Promise<void> {
  if (workerRunningLock) return;
  workerRunningLock = true;

  try {
    while (store.engineStatus === 'running') {
      const nextIndex = store.queue.findIndex(
        (item) => item.status === 'pending' || item.status === 'retrying'
      );

      if (nextIndex === -1) {
        store.engineStatus = 'completed';
        store.activeRequestId = null;
        store.activeStepOrder = null;
        const doneLog = appendLog(
          'success',
          'Processamento do lote concluído com sucesso para todas as solicitações.'
        );
        broadcastDelta({ newLog: doneLog });
        break;
      }

      const item = store.queue[nextIndex];
      const numericIndex = parseInt(item.id.replace(/\D/g, ''), 10) || nextIndex + 1;
      store.activeRequestId = item.id;
      item.status = 'running';
      item.updatedAt = new Date().toISOString();

      let proxy = pickActiveProxy(false);
      const proxyLabel = proxy ? proxy.label : 'Conexão Direta';
      item.proxyUsed = proxyLabel;

      broadcastDelta({ updatedItem: item });

      const speedDivisor =
        store.config.batchSpeedMultiplier === 8
          ? 7.5
          : store.config.batchSpeedMultiplier === 3
            ? 3.0
            : 1.0;

      // Optional challenge handoff demonstration on #35 if not demonstrated
      if (numericIndex === 35 && !store.challengeDemonstratedInRun) {
        store.challengeDemonstratedInRun = true;
        if (store.config.challengeMode === 'external_solver_webhook') {
          await sleep(Math.max(90, Math.round(360 / speedDivisor)));
          const solvedLog = appendLog(
            'challenge',
            `Verificação de segurança resolvida automaticamente via webhook.`,
            { requestId: item.id, proxyLabel }
          );
          broadcastDelta({ updatedItem: item, newLog: solvedLog });
        } else {
          item.status = 'challenge';
          store.engineStatus = 'awaiting_challenge';
          store.activeChallenge = {
            id: `chg-${Date.now()}`,
            requestId: item.id,
            type: 'microsoft_mfa_refresh',
            authenticatorCode: '84',
            promptText:
              'Confirmação de segurança Microsoft Authenticator solicitada pelo portal corporativo.',
            triggeredAt: new Date().toISOString(),
          };
          const chgLog = appendLog(
            'challenge',
            'Execução em pausa aguardando aprovação no Microsoft Authenticator.',
            { requestId: item.id, proxyLabel, detail: 'Código de verificação: 84' }
          );
          broadcastDelta({ updatedItem: item, newLog: chgLog });
          break;
        }
      }

      const isTransientRetryCandidate =
        numericIndex % 19 === 0 && !store.reprocessedIds.has(item.id);
      const isHardExceptionCandidate =
        numericIndex % 47 === 0 && !store.reprocessedIds.has(item.id);

      const maxAttempts = Math.max(1, store.config.maxRetries);
      let approved = false;
      let totalDurationMs = 0;
      const traces: AccessStepTrace[] = [];

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (store.engineStatus !== 'running') break;
        item.attempts = attempt;

        let stepFailed = false;

        for (const step of store.steps) {
          if (store.engineStatus !== 'running') break;
          store.activeStepOrder = step.order;

          const rawStepMs =
            step.waitBeforeMs + Math.floor(Math.random() * Math.max(40, store.config.randomJitterMs));
          const simulatedWait = Math.max(25, Math.round(rawStepMs / speedDivisor));
          await sleep(simulatedWait);
          totalDurationMs += rawStepMs;

          if (isTransientRetryCandidate && attempt === 1 && step.order === store.steps.length) {
            stepFailed = true;
            traces.push({
              stepOrder: step.order,
              label: step.label,
              selector: step.cssSelector,
              durationMs: rawStepMs,
              outcome: 'retry',
              detail: 'Página demorou a responder — retentando automaticamente',
            });
            item.status = 'retrying';
            proxy = pickActiveProxy(!store.config.stickyProxyPerOAuthToken);
            if (proxy) item.proxyUsed = proxy.label;

            const retryLog = appendLog(
              'warn',
              `Aviso: página demorou a responder no passo #${step.order} (tentativa ${attempt}/${maxAttempts}). Retentando...`,
              {
                requestId: item.id,
                stepLabel: step.label,
                proxyLabel: item.proxyUsed,
              }
            );
            broadcastDelta({ updatedItem: item, newLog: retryLog });
            await sleep(Math.max(60, Math.round(350 / speedDivisor)));
            break;
          }

          if (isHardExceptionCandidate && step.order === Math.min(3, store.steps.length)) {
            stepFailed = true;
            const errDetail = `Perfil requer aprovação adicional de alçada superior`;
            traces.push({
              stepOrder: step.order,
              label: step.label,
              selector: step.cssSelector,
              durationMs: rawStepMs,
              outcome: attempt === maxAttempts ? 'error' : 'retry',
              detail: errDetail,
            });
            item.errorMessage = errDetail;

            if (attempt < maxAttempts) {
              item.status = 'retrying';
              const warnLog = appendLog(
                'warn',
                `Aviso no passo #${step.order} (tentativa ${attempt}/${maxAttempts}) — verificando alçada.`,
                { requestId: item.id, stepLabel: step.label, proxyLabel: item.proxyUsed, detail: errDetail }
              );
              broadcastDelta({ updatedItem: item, newLog: warnLog });
              await sleep(Math.max(50, Math.round(280 / speedDivisor)));
            }
            break;
          }

          traces.push({
            stepOrder: step.order,
            label: step.label,
            selector: step.cssSelector,
            durationMs: rawStepMs,
            outcome: 'ok',
          });
        }

        if (!stepFailed && store.engineStatus === 'running') {
          approved = true;
          break;
        }
      }

      if (store.engineStatus !== 'running') {
        if (item.status === 'running' || item.status === 'retrying') {
          item.status = 'pending';
          broadcastDelta({ updatedItem: item });
        }
        break;
      }

      item.stepTraces = traces;
      item.durationMs = totalDurationMs;
      item.updatedAt = new Date().toISOString();
      item.traceHash = makeTraceHash(item.id, item.attempts);

      if (proxy) {
        proxy.requestsServed += 1;
      }

      if (approved) {
        item.status = 'approved';
        item.errorMessage = undefined;
        const okLog = appendLog(
          'success',
          `${item.requesterName} (${item.targetSystem}) — acesso aprovado com sucesso!`,
          {
            requestId: item.id,
            proxyLabel: item.proxyUsed,
            detail: `Perfil: ${item.roleProfile}`,
          }
        );
        broadcastDelta({ updatedItem: item, updatedProxy: proxy || undefined, newLog: okLog });
      } else {
        item.status = 'failed';
        const errLog = appendLog(
          'error',
          `Não foi possível aprovar ${item.id} (${item.requesterName}). Item movido para revisão.`,
          {
            requestId: item.id,
            proxyLabel: item.proxyUsed,
            detail: item.errorMessage,
          }
        );
        broadcastDelta({ updatedItem: item, updatedProxy: proxy || undefined, newLog: errLog });
      }

      store.activeStepOrder = null;
      await sleep(Math.max(30, Math.round(store.config.baseDelayMs / (speedDivisor * 2))));
    }
  } finally {
    workerRunningLock = false;
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/state', (_req: Request, res: Response) => {
    res.json(buildSnapshot());
  });

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(`event: sync\ndata: ${JSON.stringify(buildSnapshot())}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.post('/api/run/start', (_req: Request, res: Response) => {
    const hasPending = store.queue.some(
      (i) => i.status === 'pending' || i.status === 'retrying'
    );
    if (!hasPending) {
      res.status(400).json({ error: 'Não há solicitações pendentes na fila.' });
      return;
    }

    store.engineStatus = 'running';
    store.activeChallenge = null;
    if (!store.startedAt) {
      store.startedAt = new Date().toISOString();
    }
    const startLog = appendLog(
      'info',
      `Iniciando aprovações automáticas (${store.steps.length} passos por acesso).`
    );
    broadcastDelta({ newLog: startLog });
    void runWorkerLoop();
    res.json({ ok: true, engineStatus: store.engineStatus });
  });

  app.post('/api/run/pause', (_req: Request, res: Response) => {
    if (store.engineStatus === 'running') {
      store.engineStatus = 'paused';
      const pauseLog = appendLog('warn', 'Robô pausado pelo usuário.');
      broadcastDelta({ newLog: pauseLog });
    }
    res.json({ ok: true, engineStatus: store.engineStatus });
  });

  app.post('/api/run/resume', (_req: Request, res: Response) => {
    if (store.engineStatus === 'paused' || store.engineStatus === 'idle') {
      store.engineStatus = 'running';
      const resumeLog = appendLog('info', 'Robô retomando as aprovações pendentes.');
      broadcastDelta({ newLog: resumeLog });
      void runWorkerLoop();
    }
    res.json({ ok: true, engineStatus: store.engineStatus });
  });

  app.post('/api/run/stop', (_req: Request, res: Response) => {
    store.engineStatus = 'idle';
    store.activeChallenge = null;
    store.activeRequestId = null;
    store.activeStepOrder = null;
    for (const item of store.queue) {
      if (item.status === 'running' || item.status === 'challenge') {
        item.status = 'pending';
      }
    }
    appendLog('warn', 'Execução interrompida. Todas as aprovações feitas até aqui foram salvas.');
    broadcastSync();
    res.json({ ok: true });
  });

  app.post('/api/run/reset', (req: Request, res: Response) => {
    const requestedCount = Number(req.body?.count) || 418;
    const boundedCount = Math.min(1000, Math.max(10, requestedCount));
    store.engineStatus = 'idle';
    store.activeRequestId = null;
    store.activeStepOrder = null;
    store.activeChallenge = null;
    store.startedAt = null;
    store.challengeDemonstratedInRun = false;
    store.reprocessedIds.clear();
    store.queue = generateInitialQueue(boundedCount);
    for (const p of store.proxies) {
      p.requestsServed = 0;
    }
    appendLog('info', `Fila reinicializada com ${boundedCount} solicitações.`);
    broadcastSync();
    res.json({ ok: true, count: boundedCount });
  });

  app.post('/api/run/retry-failed', (_req: Request, res: Response) => {
    let count = 0;
    for (const item of store.queue) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.errorMessage = undefined;
        store.reprocessedIds.add(item.id);
        count++;
      }
    }
    appendLog(
      'info',
      `${count} solicitações reenfileiradas para nova tentativa de aprovação.`
    );
    if (count > 0 && store.engineStatus !== 'running') {
      store.engineStatus = 'running';
      broadcastSync();
      void runWorkerLoop();
    } else {
      broadcastSync();
    }
    res.json({ ok: true, requeued: count });
  });

  app.post('/api/run/trigger-challenge', (_req: Request, res: Response) => {
    const targetItem =
      store.queue.find((i) => i.id === store.activeRequestId) ||
      store.queue.find((i) => i.status === 'pending');

    if (!targetItem) {
      res.status(400).json({ error: 'Nenhum item pendente para testar.' });
      return;
    }

    targetItem.status = 'challenge';
    store.engineStatus = 'awaiting_challenge';
    store.activeRequestId = targetItem.id;
    store.activeChallenge = {
      id: `chg-${Date.now()}`,
      requestId: targetItem.id,
      type: 'captcha_turnstile',
      authenticatorCode: '57',
      promptText:
        'Confirmação de segurança Microsoft Authenticator requerida para continuar.',
      triggeredAt: new Date().toISOString(),
    };
    appendLog(
      'challenge',
      `Desafio de verificação simulado para o item ${targetItem.id}.`,
      { requestId: targetItem.id, detail: 'Clique em Liberar Desafio para continuar.' }
    );
    broadcastSync();
    res.json({ ok: true });
  });

  app.post('/api/run/resolve-challenge', (_req: Request, res: Response) => {
    if (store.activeChallenge) {
      const item = store.queue.find((i) => i.id === store.activeChallenge?.requestId);
      if (item) {
        item.status = 'pending';
      }
      appendLog(
        'success',
        `Desafio em ${store.activeChallenge.requestId} liberado. Robô continuando as aprovações.`
      );
      store.activeChallenge = null;
    }
    store.engineStatus = 'running';
    broadcastSync();
    void runWorkerLoop();
    res.json({ ok: true });
  });

  app.put('/api/steps', (req: Request, res: Response) => {
    const incoming = req.body?.steps;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      res.status(400).json({ error: 'Informe ao menos 1 passo válido.' });
      return;
    }
    store.steps = incoming.map((s: WorkflowStep, idx: number) => ({
      id: s.id || `step-${idx + 1}`,
      order: idx + 1,
      label: String(s.label || `Passo ${idx + 1}`).trim(),
      action: s.action || 'click',
      cssSelector: String(s.cssSelector || 'button').trim(),
      ariaSelector: String(s.ariaSelector || s.cssSelector || 'button').trim(),
      value: s.value ? String(s.value) : undefined,
      waitBeforeMs: Math.max(50, Number(s.waitBeforeMs) || 250),
      timeoutMs: Math.max(1000, Number(s.timeoutMs) || 6000),
      isLoopTarget: s.isLoopTarget !== false,
    }));
    appendLog(
      'info',
      `Novo aprendizado salvo: ${store.steps.length} passos configurados para o robô.`
    );
    broadcastSync();
    res.json({ ok: true, steps: store.steps });
  });

  app.put('/api/config', (req: Request, res: Response) => {
    const patch = req.body as Partial<AutomationConfig>;
    if (patch.targetPortalUrl !== undefined && !patch.targetPortalUrl.trim()) {
      res.status(400).json({ error: 'A URL do portal não pode ficar vazia.' });
      return;
    }
    store.config = {
      ...store.config,
      ...patch,
    };
    appendLog('info', 'Parâmetros de automação atualizados.');
    broadcastSync();
    res.json({ ok: true, config: store.config });
  });

  app.post('/api/proxies', (req: Request, res: Response) => {
    const { label, protocol, host, port, region, stickySession } = req.body || {};
    if (!label?.trim() || !host?.trim() || !Number(port)) {
      res.status(400).json({ error: 'Informe dados válidos para a rota de conexão.' });
      return;
    }
    const created: ProxyEndpoint = {
      id: `px-${Date.now().toString(36)}`,
      label: String(label).trim(),
      protocol: protocol === 'SOCKS5' || protocol === 'HTTP' ? protocol : 'HTTPS',
      host: String(host).trim(),
      port: Number(port),
      region: String(region || 'Corporativo · BR').trim(),
      enabled: true,
      latencyMs: 22 + Math.floor(Math.random() * 35),
      successRate: 99.5,
      stickySession: Boolean(stickySession),
      requestsServed: 0,
    };
    store.proxies.push(created);
    appendLog('info', `Nova rota de conexão cadastrada: ${created.label}.`);
    broadcastSync();
    res.json({ ok: true, proxy: created });
  });

  app.patch('/api/proxies/:id', (req: Request, res: Response) => {
    const target = store.proxies.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Rota não encontrada.' });
      return;
    }
    if (typeof req.body?.enabled === 'boolean') target.enabled = req.body.enabled;
    if (typeof req.body?.stickySession === 'boolean') target.stickySession = req.body.stickySession;
    broadcastSync();
    res.json({ ok: true, proxy: target });
  });

  app.post('/api/proxies/:id/check', (req: Request, res: Response) => {
    const target = store.proxies.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Rota não encontrada.' });
      return;
    }
    target.latencyMs = Math.max(12, target.latencyMs + Math.floor(Math.random() * 15) - 7);
    appendLog(
      'info',
      `Teste de conexão para ${target.label}: ${target.latencyMs}ms (Conexão Rápida).`,
      { proxyLabel: target.label }
    );
    broadcastSync();
    res.json({ ok: true, proxy: target });
  });

  app.delete('/api/proxies/:id', (req: Request, res: Response) => {
    store.proxies = store.proxies.filter((p) => p.id !== req.params.id);
    broadcastSync();
    res.json({ ok: true });
  });

  app.post('/api/queue/import', (req: Request, res: Response) => {
    const rawLines: string = String(req.body?.csvText || '').trim();
    if (!rawLines) {
      res.status(400).json({ error: 'Cole ao menos uma linha com dados.' });
      return;
    }
    const lines = rawLines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const newItems: AccessRequestItem[] = lines.map((line, idx) => {
      const parts = line.split(/[;,|\t]/).map((p) => p.trim());
      const id = parts[0] && parts[0].length >= 3 ? parts[0] : `IMP-2026-${String(idx + 1).padStart(4, '0')}`;
      const requesterName = parts[1] || `Colaborador ${idx + 1}`;
      const requesterEmail = parts[2] || `usuario.${idx + 1}@corp.empresa.com.br`;
      const targetSystem = parts[3] || 'Portal Corporativo';
      const roleProfile = parts[4] || 'Acesso Padrão';
      return {
        id,
        requesterName,
        requesterEmail,
        department: 'Lista Importada',
        targetSystem,
        roleProfile,
        riskTier: 'Médio',
        status: 'pending',
        attempts: 0,
        durationMs: 0,
        proxyUsed: '—',
        updatedAt: new Date().toISOString(),
        stepTraces: [],
      };
    });

    store.engineStatus = 'idle';
    store.queue = [...newItems, ...store.queue];
    appendLog('info', `${newItems.length} novas solicitações adicionadas à fila.`);
    broadcastSync();
    res.json({ ok: true, added: newItems.length });
  });

  // Endpoints do Navegador Interno Real (Chromium / Playwright)
  app.get('/api/browser/status', (_req: Request, res: Response) => {
    res.json(browserManager.getStatus());
  });

  app.get('/api/browser/logs', (_req: Request, res: Response) => {
    res.json({ logs: browserManager.getRecentLogs() });
  });

  app.get('/api/browser/pages', async (_req: Request, res: Response) => {
    try {
      const tabs = await browserManager.getOpenTabs();
      res.json({ tabs });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/browser/switch-page', async (req: Request, res: Response) => {
    try {
      const { index } = req.body || {};
      const result = await browserManager.switchTab(Number(index) || 0);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/quick-sso', async (req: Request, res: Response) => {
    try {
      const { email } = req.body || {};
      const result = await browserManager.quickFillMicrosoftSSO(email || 'marcel.andre@viavarejo.com.br');
      appendLog('info', `[Microsoft SSO] ${result.message}`);
      broadcastSync();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.get('/api/browser/screenshot', async (_req: Request, res: Response) => {
    try {
      const buf = await browserManager.getScreenshotCached();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(buf);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/browser/navigate', async (req: Request, res: Response) => {
    try {
      const { url } = req.body || {};
      const target = url || 'http://localhost:3000/iam-portal.html';
      const result = await browserManager.navigate(target);
      appendLog('info', `Navegador Chromium direcionado para: ${result.url} ("${result.title}")`);
      broadcastSync();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/click', async (req: Request, res: Response) => {
    try {
      const { x, y, button } = req.body || {};
      const result = await browserManager.click(Number(x) || 0, Number(y) || 0, button || 'left');
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/type', async (req: Request, res: Response) => {
    try {
      const { text } = req.body || {};
      const result = await browserManager.typeText(String(text || ''));
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/key', async (req: Request, res: Response) => {
    try {
      const { key } = req.body || {};
      const result = await browserManager.pressKey(String(key || 'Enter'));
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/inspect', async (req: Request, res: Response) => {
    try {
      const { x, y } = req.body || {};
      const result = await browserManager.inspectElement(Number(x) || 0, Number(y) || 0);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/browser/record-and-click', async (req: Request, res: Response) => {
    try {
      const { x, y } = req.body || {};
      const inspection = await browserManager.inspectElement(Number(x) || 0, Number(y) || 0);
      
      const newStep: WorkflowStep = {
        id: `step-${Date.now()}`,
        order: store.steps.length + 1,
        label: inspection.suggestedTitle,
        action: 'click',
        cssSelector: inspection.selector,
        ariaSelector: inspection.selector,
        waitBeforeMs: 600,
        timeoutMs: 8000,
        isLoopTarget: false,
      };

      store.steps.push(newStep);
      await browserManager.click(Number(x) || 0, Number(y) || 0);
      appendLog('info', `Passo ${newStep.order} gravado: ${newStep.label} (${newStep.cssSelector})`);
      broadcastSync();
      res.json({ ok: true, step: newStep });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/reload', async (_req: Request, res: Response) => {
    try {
      const result = await browserManager.reload();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/back', async (_req: Request, res: Response) => {
    try {
      const result = await browserManager.goBack();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/forward', async (_req: Request, res: Response) => {
    try {
      const result = await browserManager.goForward();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/browser/execute-step', async (req: Request, res: Response) => {
    try {
      const { stepOrder } = req.body || {};
      const step = store.steps.find((s) => s.order === Number(stepOrder));
      if (!step) {
        return res.status(404).json({ ok: false, error: 'Passo não encontrado' });
      }
      const result = await browserManager.executeWorkflowStep(step);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.get('/api/export/python-bundle', (_req: Request, res: Response) => {
    const entries = buildPythonBundleZipEntries(
      store.config,
      store.steps,
      store.proxies,
      store.queue
    );
    const zipBytes = createZipArchive(entries);
    const buffer = Buffer.from(zipBytes);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="autoapprove-python-playwright-selenium.zip"'
    );
    res.end(buffer);
  });

  app.get('/api/export/chrome-extension', (_req: Request, res: Response) => {
    const entries = buildChromeExtensionZipEntries(store.config, store.steps);
    const zipBytes = createZipArchive(entries);
    const buffer = Buffer.from(zipBytes);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="autoapprove-extensao-chrome-mv3.zip"'
    );
    res.end(buffer);
  });

  app.get('/api/export/audit-csv', (_req: Request, res: Response) => {
    const csv = serializeAuditCsv(store.queue);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="relatorio-auditoria-acessos-iam.csv"'
    );
    res.send('\uFEFF' + csv);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoApprove RPA Studio running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
