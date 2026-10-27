import React, { useMemo, useState } from 'react';
import { downloadExport } from '../lib/downloads';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Globe,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccessRequestItem,
  AccessStatus,
  ActiveChallenge,
  AutomationConfig,
  EngineStatus,
  ExecutionLogEntry,
  LogLevel,
  QueueMetrics,
  WorkflowStep,
} from '../types/automation';
import { filterQueueItems } from '../lib/seedData';

interface ExecutionDashboardViewProps {
  engineStatus: EngineStatus;
  activeRequestId: string | null;
  activeStepOrder: number | null;
  activeChallenge: ActiveChallenge | null;
  metrics: QueueMetrics;
  queue: AccessRequestItem[];
  logs: ExecutionLogEntry[];
  steps: WorkflowStep[];
  config: AutomationConfig;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onResetQueue: () => void;
  onRetryFailed: () => void;
  onTriggerChallenge: () => void;
  onResolveChallenge: () => void;
  onChangeSpeed: (speed: 1 | 3 | 8) => void;
  onImportCsv: (csvText: string) => Promise<{ ok: boolean; error?: string; added?: number }>;
  onNavigateRecorder: () => void;
  onNavigateBrowser: () => void;
  onNavigateExtension?: () => void;
}

const PAGE_SIZE = 14;

export function ExecutionDashboardView({
  engineStatus,
  activeRequestId,
  activeStepOrder,
  activeChallenge,
  metrics,
  queue,
  logs,
  steps,
  config,
  onStart,
  onPause,
  onResume,
  onStop,
  onResetQueue,
  onRetryFailed,
  onTriggerChallenge,
  onResolveChallenge,
  onChangeSpeed,
  onImportCsv,
  onNavigateRecorder,
  onNavigateBrowser,
  onNavigateExtension,
}: ExecutionDashboardViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | AccessStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [logFilter, setLogFilter] = useState<'all' | LogLevel>('all');
  const [inspectedItem, setInspectedItem] = useState<AccessRequestItem | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const filteredQueue = useMemo(
    () => filterQueueItems(queue, statusFilter, searchQuery),
    [queue, statusFilter, searchQuery]
  );

  const totalPages = Math.max(1, Math.ceil(filteredQueue.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredQueue.slice(start, start + PAGE_SIZE);
  }, [filteredQueue, safePage]);

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs.slice(0, 120);
    return logs.filter((l) => l.level === logFilter).slice(0, 120);
  }, [logs, logFilter]);

  const handleFilterChange = (next: 'all' | AccessStatus) => {
    setStatusFilter(next);
    setPage(1);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    if (!importText.trim()) {
      setImportError('Cole pelo menos uma linha no formato ID;Nome;Email;Sistema;Perfil.');
      return;
    }
    const res = await onImportCsv(importText);
    if (!res.ok) {
      setImportError(res.error || 'Não foi possível importar os registros.');
      return;
    }
    setImportText('');
    setImportModalOpen(false);
    setPage(1);
  };

  const renderStatusInline = (item: AccessRequestItem) => {
    switch (item.status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Aprovado</span>
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 whitespace-nowrap">
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>
              Em execução{activeStepOrder ? ` · P${activeStepOrder}/${steps.length}` : ''}
            </span>
          </span>
        );
      case 'retrying':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Retentativa ({item.attempts}/{config.maxRetries})</span>
          </span>
        );
      case 'challenge':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Aguardando Desafio</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Exceção ({item.attempts}x)</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Pendente</span>
          </span>
        );
    }
  };

  const formatRemaining = (sec: number): string => {
    if (sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Banner Principal em Destaque: Navegador Interno & Extensão */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-md border-2 border-blue-500/40 flex flex-col md:flex-row items-center justify-between gap-5">
        <div className="space-y-2 text-center md:text-left">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-3 py-1 rounded-full text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Navegador Chromium Real 155 Ativo no Servidor
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Treinar Robô na 1ª Rodada & Login Microsoft SSO
          </h2>
          <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
            Acesse o <strong>Navegador Interno Real</strong> para autenticar no seu portal corporativo, aprovar MFA no Authenticator e gravar os passos da primeira concessão para replicar nas outras 417 aprovações.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={onNavigateBrowser}
            className="w-full sm:w-auto px-5 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm rounded-xl shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer ring-2 ring-blue-400"
          >
            <Globe className="w-5 h-5 text-white" />
            <span>ABRIR NAVEGADOR INTERNO REAL ➔</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void downloadExport('chrome-extension');
            }}
            className="w-full sm:w-auto px-4 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Puzzle className="w-4 h-4 text-emerald-400" />
            <span>Baixar Extensão (.zip)</span>
          </button>
        </div>
      </div>

      {/* Header & Contextual Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Central de Aprovações de Acessos
            </h1>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Microsoft OAuth Ativo
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 flex flex-wrap items-center gap-2">
            <span>Processando fila de {metrics.total} concessões</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onNavigateBrowser}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Abrir no Navegador Interno (Gravar / Assistir)</span>
            </button>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Speed Segmented Control */}
          <div
            role="group"
            aria-label="Cadência do motor de execução"
            className="flex items-center gap-0.5 p-1 bg-slate-200/70 rounded-lg"
          >
            {([1, 3, 8] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onChangeSpeed(spd)}
                className={`px-2.5 py-1 text-xs font-mono tabular-nums font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  config.batchSpeedMultiplier === spd
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {spd === 1 ? '1x Humana' : spd === 3 ? '3x Ágil' : '8x Lote'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Importar CSV</span>
          </button>

          <button
            type="button"
            onClick={onTriggerChallenge}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span>Simular CAPTCHA</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void downloadExport('audit-csv');
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Challenge / MFA Handoff Banner (only visible when awaiting operator or challenge triggered) */}
      {activeChallenge && (
        <section
          aria-label="Intervenção de desafio de segurança"
          className="bg-amber-50 border border-amber-300 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Verificação Interativa Solicitada em {activeChallenge.requestId}
              </span>
            </div>
            <p className="text-sm text-amber-900">{activeChallenge.promptText}</p>
            <p className="text-xs text-amber-800 font-mono tabular-nums">
              {activeChallenge.authenticatorCode
                ? `Código Microsoft Authenticator exibido na sessão: ${activeChallenge.authenticatorCode}`
                : 'Aguardando validação Turnstile'}
              {' · '}Modo: {config.challengeMode === 'human_handoff' ? 'Handoff Assistido' : 'Webhook Externo'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onResolveChallenge}
              className="px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Confirmar Resolução e Retomar Fila
            </button>
          </div>
        </section>
      )}

      {/* Cards de Acesso Rápido — Destaque Direto para Navegador Interno e Extensão */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                🌐
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>Navegador Interno</span>
                  <span className="text-[10px] uppercase font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                    Gravar & Assistir
                  </span>
                </h2>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ensinar o robô gravando a 1ª aprovação direto na tela do portal corporativo simulado, ou ver o cursor virtual trabalhando ao vivo.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateBrowser}
            className="w-full sm:w-auto self-start inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <span>Abrir Navegador Interno</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                🧩
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>Extensão de Navegador</span>
                  <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Chrome & Edge (.zip)
                  </span>
                </h2>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Grave a 1ª rodada na aba do seu próprio navegador corporativo com Microsoft OAuth e deixe a extensão aprovando as 400+ em segundo plano.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateExtension || onNavigateRecorder}
            className="w-full sm:w-auto self-start inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <span>Ver Extensão & Baixar Arquivos</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Full-Width 4-Column Tabular KPI Strip (Single Elevation) */}
      <section
        aria-label="Indicadores de execução do lote"
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
      >
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Total na Fila de Concessão</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {metrics.total}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.pending} pendentes · {metrics.running} em curso
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Acessos Aprovados</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {metrics.approved}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.completionPercent.toFixed(1)}% concluído · média {metrics.avgDurationMs}ms
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Exceções & Retentativas</p>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.failed}
            </p>
            {metrics.failed > 0 && (
              <button
                type="button"
                onClick={onRetryFailed}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline whitespace-nowrap cursor-pointer"
              >
                Reprocessar ({metrics.failed})
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {metrics.retrying} em backoff · máx. {config.maxRetries} tentativas
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Tempo Restante Estimado</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatRemaining(
              Math.round(metrics.estimatedRemainingSec / config.batchSpeedMultiplier)
            )}
          </p>
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
            {engineStatus === 'running' ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 font-medium cursor-pointer"
              >
                <Square className="w-3 h-3" />
                <span>Interromper</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onNavigateRecorder}
                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
              >
                Editar fluxo da 1ª rodada
              </button>
            )}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onResetQueue}
              className="text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Resetar
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: High-Density Queue Grid + Real-Time Log Console */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Queue Data Grid (7 cols) */}
        <section
          aria-label="Grade de solicitações de acesso"
          className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Filtrar fila por status"
              className="flex items-center gap-0.5 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full"
            >
              {(
                [
                  { id: 'all', label: `Todos ${metrics.total}` },
                  { id: 'pending', label: `Pendentes ${metrics.pending}` },
                  { id: 'approved', label: `Aprovados ${metrics.approved}` },
                  { id: 'failed', label: `Exceções ${metrics.failed}` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleFilterChange(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                    statusFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-52 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                aria-label="Buscar por ID, colaborador ou sistema"
                placeholder="Buscar ID, nome ou sistema..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {visibleRows.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900">
                Nenhuma solicitação corresponde ao filtro selecionado.
              </p>
              <p className="text-xs text-slate-500">
                Limpe os termos de busca ou alterne o filtro de status acima para visualizar os {metrics.total} registros.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                  setPage(1);
                }}
                className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
              >
                Limpar Filtros
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4 whitespace-nowrap">Protocolo</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Colaborador & Sistema</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Duração</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Rastreio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {visibleRows.map((row) => {
                    const isCurrent = row.id === activeRequestId;
                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          isCurrent ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                          {row.id}
                        </td>
                        <td className="py-2.5 px-3 max-w-[250px]">
                          <div className="font-medium text-slate-900 truncate">
                            {row.requesterName}
                          </div>
                          <div className="text-slate-500 truncate">
                            {row.targetSystem} · {row.roleProfile}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {renderStatusInline(row)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {row.durationMs > 0 ? `${row.durationMs}ms` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setInspectedItem(row)}
                            aria-label={`Inspecionar rastreio de ${row.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-mono tabular-nums">
              Página {safePage} de {totalPages} · {filteredQueue.length} itens filtrados
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Página anterior"
                className="p-1.5 rounded-md border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Próxima página"
                className="p-1.5 rounded-md border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* Real-Time Structured Log Console (5 cols) */}
        <section
          aria-label="Console de logs em tempo real"
          className="xl:col-span-5 bg-slate-900 text-slate-100 border border-slate-800 rounded-xl overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Telemetria & Auditoria Ao Vivo</h2>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {logs.length} eventos registrados na sessão
              </p>
            </div>

            <div
              role="group"
              aria-label="Filtrar nível de log"
              className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg"
            >
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'success', label: 'OK' },
                  { id: 'warn', label: 'Retry' },
                  { id: 'error', label: 'Falhas' },
                ] as const
              ).map((lv) => (
                <button
                  key={lv.id}
                  type="button"
                  onClick={() => setLogFilter(lv.id)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    logFilter === lv.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lv.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 h-[515px] overflow-y-auto space-y-2.5 font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <p className="text-slate-400 py-8 text-center">
                Nenhum evento registrado para este filtro de severidade.
              </p>
            ) : (
              filteredLogs.map((entry) => {
                let tagText = 'INFO';
                let tagColor = 'text-slate-400';
                if (entry.level === 'success') {
                  tagText = 'APROV';
                  tagColor = 'text-emerald-400';
                } else if (entry.level === 'warn') {
                  tagText = 'RETRY';
                  tagColor = 'text-amber-400';
                } else if (entry.level === 'error') {
                  tagText = 'ERRO';
                  tagColor = 'text-rose-400';
                } else if (entry.level === 'challenge') {
                  tagText = 'MFA/CAP';
                  tagColor = 'text-amber-300';
                }

                return (
                  <div
                    key={entry.id}
                    className="pb-2.5 border-b border-slate-800/80 last:border-b-0 leading-relaxed"
                  >
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                      <span>{entry.timestamp.slice(11, 23)}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${tagColor}`}>{tagText}</span>
                      {entry.requestId && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-200">{entry.requestId}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-0.5 text-slate-100">{entry.message}</p>
                    {(entry.detail || entry.proxyLabel) && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {entry.proxyLabel ? `Rota: ${entry.proxyLabel}` : ''}
                        {entry.proxyLabel && entry.detail ? ' · ' : ''}
                        {entry.detail || ''}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>
              Estado:{' '}
              <strong className="text-slate-200 font-semibold">
                {engineStatus === 'running'
                  ? 'Executando lote'
                  : engineStatus === 'paused'
                    ? 'Pausado'
                    : engineStatus === 'awaiting_challenge'
                      ? 'Aguardando desafio'
                      : engineStatus === 'completed'
                        ? 'Lote concluído'
                        : 'Pronto para iniciar'}
              </strong>
            </span>
            {engineStatus === 'idle' || engineStatus === 'paused' ? (
              <button
                type="button"
                onClick={engineStatus === 'paused' ? onResume : onStart}
                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{engineStatus === 'paused' ? 'Retomar agora' : 'Executar lote'}</span>
              </button>
            ) : engineStatus === 'running' ? (
              <button
                type="button"
                onClick={onPause}
                className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
              >
                Pausar stream
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {/* Trace Inspector Modal / Drawer */}
      {inspectedItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="trace-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40"
        >
          <div className="bg-white w-full max-w-lg h-full shadow-xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="trace-dialog-title" className="text-base font-bold text-slate-900">
                  Rastreabilidade · {inspectedItem.id}
                </h2>
                <p className="text-xs text-slate-500">
                  {inspectedItem.requesterName} ({inspectedItem.requesterEmail})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedItem(null)}
                aria-label="Fechar painel de rastreabilidade"
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6 text-sm">
              <div className="grid grid-cols-2 gap-4 pb-5 border-b border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Sistema & Perfil</span>
                  <strong className="text-slate-900 font-medium">
                    {inspectedItem.targetSystem} · {inspectedItem.roleProfile}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Departamento / Criticidade</span>
                  <strong className="text-slate-900 font-medium">
                    {inspectedItem.department} · {inspectedItem.riskTier}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Rota Proxy Utilizada</span>
                  <strong className="text-slate-900 font-mono">{inspectedItem.proxyUsed}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Hash de Auditoria</span>
                  <strong className="text-slate-900 font-mono tabular-nums">
                    {inspectedItem.traceHash || 'Aguardando execução'}
                  </strong>
                </div>
              </div>

              {inspectedItem.errorMessage && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 space-y-1">
                  <p className="font-semibold">Diagnóstico da Exceção Capturada</p>
                  <p className="font-mono">{inspectedItem.errorMessage}</p>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Passos Executados no DOM ({inspectedItem.stepTraces.length})
                </h3>
                {inspectedItem.stepTraces.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Esta solicitação ainda aguarda processamento na fila. Inicie o lote para registrar a telemetria passo a passo.
                  </p>
                ) : (
                  <ol className="divide-y divide-slate-200 border-t border-b border-slate-200">
                    {inspectedItem.stepTraces.map((tr, i) => (
                      <li key={`${tr.stepOrder}-${i}`} className="py-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">
                            {tr.stepOrder}. {tr.label}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {tr.durationMs}ms ·{' '}
                            <strong
                              className={
                                tr.outcome === 'ok'
                                  ? 'text-emerald-700'
                                  : tr.outcome === 'retry'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                              }
                            >
                              {tr.outcome.toUpperCase()}
                            </strong>
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-slate-500 truncate">
                          {tr.selector}
                        </p>
                        {tr.detail && <p className="text-[11px] text-amber-800">{tr.detail}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="csv-import-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
        >
          <div className="bg-white w-full max-w-lg rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="csv-import-title" className="text-base font-bold text-slate-900">
                Importar Lista de Acessos Pendentes (CSV / Texto)
              </h2>
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                  setImportError(null);
                }}
                aria-label="Fechar modal de importação"
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="csv-textarea"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Cole uma solicitação por linha (`ID;Colaborador;Email;Sistema;Perfil`):
                </label>
                <textarea
                  id="csv-textarea"
                  rows={5}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={
                    'IAM-2026-0501;Helena Prado;helena.prado@corp.com.br;SAP S/4HANA;Aprovador Fiscal\nIAM-2026-0502;Caio Nunes;caio.nunes@corp.com.br;Databricks;Analista Dados'
                  }
                  className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                />
                {importError && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{importError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false);
                    setImportError(null);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                >
                  Adicionar à Fila
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
