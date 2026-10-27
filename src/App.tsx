import React, { useCallback, useEffect, useState } from 'react';
import type {
  AccessRequestItem,
  ActiveChallenge,
  AutomationConfig,
  AutomationStateSnapshot,
  EngineStatus,
  ExecutionLogEntry,
  ProxyEndpoint,
  QueueMetrics,
  WorkflowStep,
} from './types/automation';
import { WorkspaceChrome, type WorkspaceTab } from './components/WorkspaceChrome';
import { ExecutionDashboardView } from './components/ExecutionDashboardView';
import { InternalBrowserView } from './components/InternalBrowserView';
import { ExtensionStudioView } from './components/ExtensionStudioView';
import { AdvancedSettingsView } from './components/AdvancedSettingsView';

function resolveInitialTab(): WorkspaceTab {
  if (typeof window === 'undefined') return 'browser';
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'dashboard') return 'dashboard';
  if (tab === 'extension') return 'extension';
  if (tab === 'advanced' || tab === 'python' || tab === 'resilience') return 'advanced';
  return 'browser';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(resolveInitialTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [state, setState] = useState<AutomationStateSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const fetchFullState = useCallback(async () => {
    try {
      const resp = await fetch('/api/state');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const snap = (await resp.json()) as AutomationStateSnapshot;
      setState(snap);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Falha de conexão com o serviço de automação.'
      );
    }
  }, []);

  useEffect(() => {
    void fetchFullState();

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectStream = () => {
      es = new EventSource('/api/events');

      es.onopen = () => {
        setSseConnected(true);
        setLoadError(null);
      };

      es.addEventListener('sync', (ev: MessageEvent) => {
        try {
          const snap = JSON.parse(ev.data) as AutomationStateSnapshot;
          setState(snap);
        } catch {
          // Ignore
        }
      });

      es.addEventListener('delta', (ev: MessageEvent) => {
        try {
          const delta = JSON.parse(ev.data) as {
            engineStatus: EngineStatus;
            activeRequestId: string | null;
            activeStepOrder: number | null;
            activeChallenge: ActiveChallenge | null;
            metrics: QueueMetrics;
            updatedItem?: AccessRequestItem;
            updatedProxy?: ProxyEndpoint;
            newLog?: ExecutionLogEntry;
          };

          setState((prev) => {
            if (!prev) return prev;
            const nextQueue = delta.updatedItem
              ? prev.queue.map((q) => (q.id === delta.updatedItem!.id ? delta.updatedItem! : q))
              : prev.queue;

            const nextProxies = delta.updatedProxy
              ? prev.proxies.map((p) => (p.id === delta.updatedProxy!.id ? delta.updatedProxy! : p))
              : prev.proxies;

            const nextLogs =
              delta.newLog && !prev.logs.some((l) => l.id === delta.newLog!.id)
                ? [delta.newLog, ...prev.logs].slice(0, 350)
                : prev.logs;

            return {
              ...prev,
              engineStatus: delta.engineStatus,
              activeRequestId: delta.activeRequestId,
              activeStepOrder: delta.activeStepOrder,
              activeChallenge: delta.activeChallenge,
              metrics: delta.metrics,
              queue: nextQueue,
              proxies: nextProxies,
              logs: nextLogs,
            };
          });
        } catch {
          // Ignore
        }
      });

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        reconnectTimer = setTimeout(() => {
          void fetchFullState();
          connectStream();
        }, 2000);
      };
    };

    connectStream();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fetchFullState]);

  const postAction = async (endpoint: string, body?: unknown) => {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, ...data };
  };

  const handlePrimaryTopAction = () => {
    if (!state) return;
    if (state.engineStatus === 'running') {
      void postAction('/api/run/pause');
    } else if (state.engineStatus === 'awaiting_challenge') {
      void postAction('/api/run/resolve-challenge');
    } else if (state.engineStatus === 'paused') {
      void postAction('/api/run/resume');
    } else if (state.metrics.pending > 0) {
      setActiveTab('dashboard');
      void postAction('/api/run/start');
    } else {
      void postAction('/api/run/reset', { count: 418 });
    }
  };

  if (loadError && !state) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">
            Serviço de Automação Indisponível
          </h1>
          <p className="text-sm text-slate-600">
            Não foi possível carregar o estado inicial da fila ({loadError}).
          </p>
          <button
            type="button"
            onClick={() => void fetchFullState()}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 max-w-[1440px] mx-auto space-y-6">
        <div className="h-8 w-72 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-white border border-slate-200 rounded-2xl p-5" />
          ))}
        </div>
        <div className="h-96 bg-white border border-slate-200 rounded-2xl" />
      </div>
    );
  }

  const activeProxiesCount = state.proxies.filter((p) => p.enabled).length;

  return (
    <WorkspaceChrome
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      engineStatus={state.engineStatus}
      metrics={state.metrics}
      stepsCount={state.steps.length}
      activeProxiesCount={activeProxiesCount}
      sseConnected={sseConnected}
      mobileMenuOpen={mobileMenuOpen}
      onToggleMobileMenu={setMobileMenuOpen}
      onPrimaryAction={handlePrimaryTopAction}
    >
      {activeTab === 'dashboard' && (
        <ExecutionDashboardView
          engineStatus={state.engineStatus}
          activeRequestId={state.activeRequestId}
          activeStepOrder={state.activeStepOrder}
          activeChallenge={state.activeChallenge}
          metrics={state.metrics}
          queue={state.queue}
          logs={state.logs}
          steps={state.steps}
          config={state.config}
          onStart={() => void postAction('/api/run/start')}
          onPause={() => void postAction('/api/run/pause')}
          onResume={() => void postAction('/api/run/resume')}
          onStop={() => void postAction('/api/run/stop')}
          onResetQueue={() => void postAction('/api/run/reset', { count: 418 })}
          onRetryFailed={() => void postAction('/api/run/retry-failed')}
          onTriggerChallenge={() => void postAction('/api/run/trigger-challenge')}
          onResolveChallenge={() => void postAction('/api/run/resolve-challenge')}
          onChangeSpeed={(spd) => {
            void fetch('/api/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchSpeedMultiplier: spd }),
            });
          }}
          onImportCsv={(csvText) => postAction('/api/queue/import', { csvText })}
          onNavigateRecorder={() => setActiveTab('browser')}
          onNavigateBrowser={() => setActiveTab('browser')}
          onNavigateExtension={() => setActiveTab('extension')}
        />
      )}

      {activeTab === 'browser' && (
        <InternalBrowserView
          steps={state.steps}
          queue={state.queue}
          engineStatus={state.engineStatus}
          activeRequestId={state.activeRequestId}
          activeStepOrder={state.activeStepOrder}
          targetPortalUrl={state.config.targetPortalUrl}
          microsoftHint={state.config.microsoftTenantHint}
          onSaveSteps={async (nextSteps: WorkflowStep[]) => {
            const resp = await fetch('/api/steps', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ steps: nextSteps }),
            });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
          }}
          onStartExecution={() => void postAction('/api/run/start')}
          onPauseExecution={() => void postAction('/api/run/pause')}
        />
      )}

      {activeTab === 'extension' && (
        <ExtensionStudioView config={state.config} steps={state.steps} />
      )}

      {activeTab === 'advanced' && (
        <AdvancedSettingsView
          config={state.config}
          steps={state.steps}
          proxies={state.proxies}
          onSaveConfig={async (patch: Partial<AutomationConfig>) => {
            const resp = await fetch('/api/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
          }}
          onAddProxy={(payload) => postAction('/api/proxies', payload)}
          onToggleProxy={async (id, enabled) => {
            await fetch(`/api/proxies/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled }),
            });
          }}
          onCheckProxy={async (id) => {
            await postAction(`/api/proxies/${id}/check`);
          }}
          onDeleteProxy={async (id) => {
            await fetch(`/api/proxies/${id}`, { method: 'DELETE' });
          }}
          onTriggerChallenge={() => {
            setActiveTab('dashboard');
            void postAction('/api/run/trigger-challenge');
          }}
        />
      )}
    </WorkspaceChrome>
  );
}
