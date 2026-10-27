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
} from '../types/automation.ts';
import {
  computeQueueMetrics,
  generateInitialQueue,
  getDefaultConfig,
  getDefaultProxies,
  getDefaultWorkflowSteps,
} from './seedData.ts';

/**
 * Motor de automação que roda no próprio navegador.
 *
 * O servidor Express original simula o processamento da fila (não há chamada a
 * um IAM real). Este módulo reproduz a mesma máquina de estados no cliente,
 * para o estúdio continuar funcional em hospedagem estática — Vercel, GitHub
 * Pages — e sobreviver a recarregamentos via localStorage.
 */

const STORAGE_KEY = 'autoapprove.localEngine.v1';
const MAX_LOGS = 350;
const MAX_QUEUE = 1000;

interface EngineState {
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
  reprocessedIds: string[];
}

type Listener = () => void;

const listeners = new Set<Listener>();
let workerRunning = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let emitHandle: ReturnType<typeof setTimeout> | null = null;
let state: EngineState;

function makeLog(
  level: LogLevel,
  message: string,
  opts?: { requestId?: string; stepLabel?: string; proxyLabel?: string; detail?: string }
): ExecutionLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    requestId: opts?.requestId,
    stepLabel: opts?.stepLabel,
    proxyLabel: opts?.proxyLabel,
    message,
    detail: opts?.detail,
  };
}

function createInitialState(): EngineState {
  return {
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
      makeLog(
        'info',
        'Sessão pronta: 418 solicitações carregadas. O motor roda localmente no seu navegador.',
        { detail: 'Mantenha esta aba aberta durante a execução simulada.' }
      ),
    ],
    activeProxyIndex: 0,
    challengeDemonstratedInRun: false,
    reprocessedIds: [],
  };
}

function readStorage(): EngineState | null {
  try {
    if (typeof localStorage === 'undefined') return null;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<EngineState>;
    if (!parsed || !Array.isArray(parsed.queue) || parsed.queue.length === 0) return null;

    return {
      ...createInitialState(),
      ...parsed,
      reprocessedIds: Array.isArray(parsed.reprocessedIds) ? parsed.reprocessedIds : [],
      queue: parsed.queue,
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return null;
  }
}

state = readStorage() || createInitialState();

function scheduleSave(): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Cota estourada (fila muito grande): segue apenas em memória.
    }
  }, 400);
}

/**
 * Notifica a UI, coalescendo rajadas.
 *
 * Em velocidade alta o motor emite a cada ~25ms; sem coalescer, o React
 * re-renderizaria a tabela de centenas de linhas quarenta vezes por segundo.
 */
function emit(): void {
  scheduleSave();
  if (emitHandle) return;

  emitHandle = setTimeout(() => {
    emitHandle = null;
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // um listener com erro não pode derrubar o motor
      }
    }
  }, 60);
}

export function subscribeLocalEngine(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocalSnapshot(): AutomationStateSnapshot {
  return {
    engineStatus: state.engineStatus,
    activeRequestId: state.activeRequestId,
    activeStepOrder: state.activeStepOrder,
    activeChallenge: state.activeChallenge,
    startedAt: state.startedAt,
    config: state.config,
    steps: state.steps,
    proxies: state.proxies,
    queue: state.queue,
    logs: state.logs,
    metrics: computeQueueMetrics(state.queue),
  };
}

function appendLog(
  level: LogLevel,
  message: string,
  opts?: { requestId?: string; stepLabel?: string; proxyLabel?: string; detail?: string }
): ExecutionLogEntry {
  const entry = makeLog(level, message, opts);
  state.logs = [entry, ...state.logs].slice(0, MAX_LOGS);
  return entry;
}

function pickProxy(rotate = false): ProxyEndpoint | null {
  const enabled = state.proxies.filter((proxy) => proxy.enabled);
  if (enabled.length === 0) return null;

  if (rotate && enabled.length > 1) {
    state.activeProxyIndex = (state.activeProxyIndex + 1) % enabled.length;
  }

  return enabled[state.activeProxyIndex % enabled.length];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function traceHash(requestId: string, attempts: number): string {
  let hash = 2166136261;
  const input = `${requestId}:${attempts}:${Date.now()}`;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `trc_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function speedDivisor(): number {
  if (state.config.batchSpeedMultiplier === 8) return 7.5;
  if (state.config.batchSpeedMultiplier === 3) return 3;
  return 1;
}

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;

  try {
    while (state.engineStatus === 'running') {
      const nextIndex = state.queue.findIndex(
        (item) => item.status === 'pending' || item.status === 'retrying'
      );

      if (nextIndex === -1) {
        state.engineStatus = 'completed';
        state.activeRequestId = null;
        state.activeStepOrder = null;
        appendLog('success', 'Processamento do lote concluído: todas as solicitações foram tratadas.');
        emit();
        break;
      }

      const item = state.queue[nextIndex];
      const numericIndex = parseInt(item.id.replace(/\D/g, ''), 10) || nextIndex + 1;

      state.activeRequestId = item.id;
      item.status = 'running';
      item.updatedAt = new Date().toISOString();

      let proxy = pickProxy(false);
      item.proxyUsed = proxy ? proxy.label : 'Conexão Direta';
      emit();

      const divisor = speedDivisor();

      // Desafio de MFA demonstrado uma vez por execução, no item #35
      if (numericIndex === 35 && !state.challengeDemonstratedInRun) {
        state.challengeDemonstratedInRun = true;

        if (state.config.challengeMode === 'external_solver_webhook') {
          await sleep(Math.max(90, Math.round(360 / divisor)));
          appendLog('challenge', 'Verificação de segurança resolvida automaticamente via webhook.', {
            requestId: item.id,
            proxyLabel: item.proxyUsed,
          });
        } else {
          item.status = 'challenge';
          state.engineStatus = 'awaiting_challenge';
          state.activeChallenge = {
            id: `chg-${Date.now()}`,
            requestId: item.id,
            type: 'microsoft_mfa_refresh',
            authenticatorCode: '84',
            promptText:
              'Confirmação de segurança Microsoft Authenticator solicitada pelo portal corporativo.',
            triggeredAt: new Date().toISOString(),
          };
          appendLog('challenge', 'Execução em pausa aguardando aprovação no Microsoft Authenticator.', {
            requestId: item.id,
            proxyLabel: item.proxyUsed,
            detail: 'Código de verificação: 84',
          });
          emit();
          break;
        }
      }

      const alreadyReprocessed = state.reprocessedIds.includes(item.id);
      const transientRetry = numericIndex % 19 === 0 && !alreadyReprocessed;
      const hardFailure = numericIndex % 47 === 0 && !alreadyReprocessed;

      const maxAttempts = Math.max(1, state.config.maxRetries);
      let approved = false;
      let totalDurationMs = 0;
      const traces: AccessStepTrace[] = [];

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (state.engineStatus !== 'running') break;
        item.attempts = attempt;

        let stepFailed = false;

        for (const step of state.steps) {
          if (state.engineStatus !== 'running') break;
          state.activeStepOrder = step.order;

          const rawStepMs =
            step.waitBeforeMs + Math.floor(Math.random() * Math.max(40, state.config.randomJitterMs));
          const simulatedWait = Math.max(25, Math.round(rawStepMs / divisor));
          await sleep(simulatedWait);
          totalDurationMs += rawStepMs;

          if (transientRetry && attempt === 1 && step.order === state.steps.length) {
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

            const rotated = pickProxy(!state.config.stickyProxyPerOAuthToken);
            if (rotated) item.proxyUsed = rotated.label;

            appendLog(
              'warn',
              `Aviso: página demorou a responder no passo #${step.order} (tentativa ${attempt}/${maxAttempts}). Retentando...`,
              { requestId: item.id, stepLabel: step.label, proxyLabel: item.proxyUsed }
            );
            emit();
            await sleep(Math.max(60, Math.round(350 / divisor)));
            break;
          }

          if (hardFailure && step.order === Math.min(3, state.steps.length)) {
            stepFailed = true;
            const detail = 'Perfil requer aprovação adicional de alçada superior';
            traces.push({
              stepOrder: step.order,
              label: step.label,
              selector: step.cssSelector,
              durationMs: rawStepMs,
              outcome: attempt === maxAttempts ? 'error' : 'retry',
              detail,
            });
            item.errorMessage = detail;

            if (attempt < maxAttempts) {
              item.status = 'retrying';
              appendLog(
                'warn',
                `Aviso no passo #${step.order} (tentativa ${attempt}/${maxAttempts}) — verificando alçada.`,
                { requestId: item.id, stepLabel: step.label, proxyLabel: item.proxyUsed, detail }
              );
              emit();
              await sleep(Math.max(50, Math.round(280 / divisor)));
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

        if (!stepFailed && state.engineStatus === 'running') {
          approved = true;
          break;
        }
      }

      if (state.engineStatus !== 'running') {
        if (item.status === 'running' || item.status === 'retrying') {
          item.status = 'pending';
        }
        emit();
        break;
      }

      item.stepTraces = traces;
      item.durationMs = totalDurationMs;
      item.updatedAt = new Date().toISOString();
      item.traceHash = traceHash(item.id, item.attempts);

      if (proxy) proxy.requestsServed += 1;

      if (approved) {
        item.status = 'approved';
        item.errorMessage = undefined;
        appendLog(
          'success',
          `${item.requesterName} (${item.targetSystem}) — acesso aprovado com sucesso!`,
          { requestId: item.id, proxyLabel: item.proxyUsed, detail: `Perfil: ${item.roleProfile}` }
        );
      } else {
        item.status = 'failed';
        appendLog(
          'error',
          `Não foi possível aprovar ${item.id} (${item.requesterName}). Item movido para revisão.`,
          { requestId: item.id, proxyLabel: item.proxyUsed, detail: item.errorMessage }
        );
      }

      state.activeStepOrder = null;
      emit();
      await sleep(Math.max(30, Math.round(state.config.baseDelayMs / (divisor * 2))));
    }
  } finally {
    workerRunning = false;
  }
}

// ==========================================
// AÇÕES (mesma semântica dos endpoints Express)
// ==========================================

export function startRun(): { ok: boolean; error?: string; engineStatus: EngineStatus } {
  const hasPending = state.queue.some(
    (item) => item.status === 'pending' || item.status === 'retrying'
  );

  if (!hasPending) {
    return {
      ok: false,
      error: 'Não há solicitações pendentes na fila.',
      engineStatus: state.engineStatus,
    };
  }

  state.engineStatus = 'running';
  state.activeChallenge = null;
  if (!state.startedAt) state.startedAt = new Date().toISOString();

  appendLog('info', `Iniciando aprovações automáticas (${state.steps.length} passos por acesso).`);
  emit();
  void runWorker();

  return { ok: true, engineStatus: state.engineStatus };
}

export function pauseRun(): { ok: boolean; engineStatus: EngineStatus } {
  if (state.engineStatus === 'running') {
    state.engineStatus = 'paused';
    appendLog('warn', 'Robô pausado pelo usuário.');
    emit();
  }

  return { ok: true, engineStatus: state.engineStatus };
}

export function resumeRun(): { ok: boolean; engineStatus: EngineStatus } {
  if (state.engineStatus === 'paused' || state.engineStatus === 'idle') {
    state.engineStatus = 'running';
    appendLog('info', 'Robô retomando as aprovações pendentes.');
    emit();
    void runWorker();
  }

  return { ok: true, engineStatus: state.engineStatus };
}

export function stopRun(): { ok: boolean } {
  state.engineStatus = 'idle';
  state.activeChallenge = null;
  state.activeRequestId = null;
  state.activeStepOrder = null;

  for (const item of state.queue) {
    if (item.status === 'running' || item.status === 'challenge') item.status = 'pending';
  }

  appendLog('warn', 'Execução interrompida. Todas as aprovações feitas até aqui foram salvas.');
  emit();
  return { ok: true };
}

export function resetQueue(count = 418): { ok: boolean; count: number } {
  const requested = Number(count) || 418;
  const bounded = Math.min(MAX_QUEUE, Math.max(10, requested));

  state.engineStatus = 'idle';
  state.activeRequestId = null;
  state.activeStepOrder = null;
  state.activeChallenge = null;
  state.startedAt = null;
  state.challengeDemonstratedInRun = false;
  state.reprocessedIds = [];
  state.queue = generateInitialQueue(bounded);

  for (const proxy of state.proxies) proxy.requestsServed = 0;

  appendLog('info', `Fila reinicializada com ${bounded} solicitações.`);
  emit();

  return { ok: true, count: bounded };
}

export function retryFailed(): { ok: boolean; requeued: number } {
  let count = 0;

  for (const item of state.queue) {
    if (item.status === 'failed') {
      item.status = 'pending';
      item.errorMessage = undefined;
      if (!state.reprocessedIds.includes(item.id)) state.reprocessedIds.push(item.id);
      count += 1;
    }
  }

  appendLog('info', `${count} solicitações reenfileiradas para nova tentativa de aprovação.`);

  if (count > 0 && state.engineStatus !== 'running') {
    state.engineStatus = 'running';
    emit();
    void runWorker();
  } else {
    emit();
  }

  return { ok: true, requeued: count };
}

export function triggerChallenge(): { ok: boolean; error?: string } {
  const target =
    state.queue.find((item) => item.id === state.activeRequestId) ||
    state.queue.find((item) => item.status === 'pending');

  if (!target) return { ok: false, error: 'Nenhum item pendente para testar.' };

  target.status = 'challenge';
  state.engineStatus = 'awaiting_challenge';
  state.activeRequestId = target.id;
  state.activeChallenge = {
    id: `chg-${Date.now()}`,
    requestId: target.id,
    type: 'captcha_turnstile',
    authenticatorCode: '57',
    promptText: 'Confirmação de segurança Microsoft Authenticator requerida para continuar.',
    triggeredAt: new Date().toISOString(),
  };

  appendLog('challenge', `Desafio de verificação simulado para o item ${target.id}.`, {
    requestId: target.id,
    detail: 'Clique em Liberar Desafio para continuar.',
  });
  emit();

  return { ok: true };
}

export function resolveChallenge(): { ok: boolean } {
  if (state.activeChallenge) {
    const item = state.queue.find((entry) => entry.id === state.activeChallenge?.requestId);
    if (item) item.status = 'pending';

    appendLog(
      'success',
      `Desafio em ${state.activeChallenge.requestId} liberado. Robô continuando as aprovações.`
    );
    state.activeChallenge = null;
  }

  state.engineStatus = 'running';
  emit();
  void runWorker();

  return { ok: true };
}

export function updateSteps(incoming: WorkflowStep[]): { ok: boolean; error?: string } {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { ok: false, error: 'Informe ao menos 1 passo válido.' };
  }

  state.steps = incoming.map((step, index) => ({
    id: step.id || `step-${index + 1}`,
    order: index + 1,
    label: String(step.label || `Passo ${index + 1}`).trim(),
    action: step.action || 'click',
    cssSelector: String(step.cssSelector || 'button').trim(),
    ariaSelector: String(step.ariaSelector || step.cssSelector || 'button').trim(),
    value: step.value ? String(step.value) : undefined,
    waitBeforeMs: Math.max(50, Number(step.waitBeforeMs) || 250),
    timeoutMs: Math.max(1000, Number(step.timeoutMs) || 6000),
    isLoopTarget: step.isLoopTarget !== false,
  }));

  appendLog('info', `Novo aprendizado salvo: ${state.steps.length} passos configurados para o robô.`);
  emit();

  return { ok: true };
}

export function updateConfig(patch: Partial<AutomationConfig>): { ok: boolean; error?: string } {
  if (patch.targetPortalUrl !== undefined && !String(patch.targetPortalUrl).trim()) {
    return { ok: false, error: 'A URL do portal não pode ficar vazia.' };
  }

  state.config = { ...state.config, ...patch };
  appendLog('info', 'Parâmetros de automação atualizados.');
  emit();

  return { ok: true };
}

export function addProxy(payload: {
  label?: string;
  protocol?: string;
  host?: string;
  port?: number | string;
  region?: string;
  stickySession?: boolean;
}): { ok: boolean; error?: string; proxy?: ProxyEndpoint } {
  if (!payload?.label?.trim() || !payload?.host?.trim() || !Number(payload.port)) {
    return { ok: false, error: 'Informe dados válidos para a rota de conexão.' };
  }

  const created: ProxyEndpoint = {
    id: `px-${Date.now().toString(36)}`,
    label: String(payload.label).trim(),
    protocol:
      payload.protocol === 'SOCKS5' || payload.protocol === 'HTTP' ? payload.protocol : 'HTTPS',
    host: String(payload.host).trim(),
    port: Number(payload.port),
    region: String(payload.region || 'Corporativo · BR').trim(),
    enabled: true,
    latencyMs: 22 + Math.floor(Math.random() * 35),
    successRate: 99.5,
    stickySession: Boolean(payload.stickySession),
    requestsServed: 0,
  };

  state.proxies.push(created);
  appendLog('info', `Nova rota de conexão cadastrada: ${created.label}.`);
  emit();

  return { ok: true, proxy: created };
}

export function patchProxy(
  id: string,
  patch: { enabled?: boolean; stickySession?: boolean }
): { ok: boolean; error?: string } {
  const target = state.proxies.find((proxy) => proxy.id === id);
  if (!target) return { ok: false, error: 'Rota não encontrada.' };

  if (typeof patch.enabled === 'boolean') target.enabled = patch.enabled;
  if (typeof patch.stickySession === 'boolean') target.stickySession = patch.stickySession;

  emit();
  return { ok: true };
}

export function checkProxy(id: string): { ok: boolean; error?: string } {
  const target = state.proxies.find((proxy) => proxy.id === id);
  if (!target) return { ok: false, error: 'Rota não encontrada.' };

  target.latencyMs = Math.max(12, target.latencyMs + Math.floor(Math.random() * 15) - 7);
  appendLog('info', `Teste de conexão para ${target.label}: ${target.latencyMs}ms (Conexão Rápida).`, {
    proxyLabel: target.label,
  });
  emit();

  return { ok: true };
}

export function deleteProxy(id: string): { ok: boolean } {
  state.proxies = state.proxies.filter((proxy) => proxy.id !== id);
  emit();
  return { ok: true };
}

export function importQueue(csvText: string): { ok: boolean; error?: string; added?: number } {
  const raw = String(csvText || '').trim();
  if (!raw) return { ok: false, error: 'Cole ao menos uma linha com dados.' };

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const newItems: AccessRequestItem[] = lines.map((line, index) => {
    const parts = line.split(/[;,|\t]/).map((part) => part.trim());

    return {
      id:
        parts[0] && parts[0].length >= 3
          ? parts[0]
          : `IMP-2026-${String(index + 1).padStart(4, '0')}`,
      requesterName: parts[1] || `Colaborador ${index + 1}`,
      requesterEmail: parts[2] || `usuario.${index + 1}@corp.empresa.com.br`,
      department: 'Lista Importada',
      targetSystem: parts[3] || 'Portal Corporativo',
      roleProfile: parts[4] || 'Acesso Padrão',
      riskTier: 'Médio',
      status: 'pending',
      attempts: 0,
      durationMs: 0,
      proxyUsed: '—',
      updatedAt: new Date().toISOString(),
      stepTraces: [],
    } as AccessRequestItem;
  });

  state.engineStatus = 'idle';
  state.queue = [...newItems, ...state.queue].slice(0, MAX_QUEUE);
  appendLog('info', `${newItems.length} novas solicitações adicionadas à fila.`);
  emit();

  return { ok: true, added: newItems.length };
}

export function getQueueSnapshot(): AccessRequestItem[] {
  return state.queue;
}

/**
 * Retoma uma execução que estava rodando quando a aba foi recarregada.
 * Chamado uma única vez na inicialização do app.
 */
export function resumeIfInterrupted(): void {
  if (state.engineStatus === 'running' && !workerRunning) {
    appendLog('info', 'Execução retomada após recarregar a página.');
    emit();
    void runWorker();
  }
}
