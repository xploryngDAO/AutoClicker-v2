import React from 'react';
import {
  Compass,
  Download,
  FileCode2,
  Globe,
  ListChecks,
  Pause,
  Play,
  Puzzle,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type { EngineStatus, QueueMetrics } from '../types/automation';
import { MasterPromptModal } from './MasterPromptModal';
import { downloadExport } from '../lib/downloads';
import { isLocalMode } from '../lib/localApiBridge';

export type WorkspaceTab = 'dashboard' | 'browser' | 'extension' | 'advanced';

interface WorkspaceChromeProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  engineStatus: EngineStatus;
  metrics: QueueMetrics;
  stepsCount: number;
  activeProxiesCount: number;
  sseConnected: boolean;
  demoMode?: boolean;
  mobileMenuOpen: boolean;
  onToggleMobileMenu: (open: boolean) => void;
  onPrimaryAction: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  badge?: string;
  badgeHighlight?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'browser',
    label: 'Navegador Interno Real (Chromium)',
    badge: '● Gravar 1ª Rodada & MFA',
    badgeHighlight: true,
    icon: Globe,
  },
  {
    id: 'dashboard',
    label: 'Central de Aprovações',
    badge: '418 itens',
    badgeHighlight: false,
    icon: ListChecks,
  },
  {
    id: 'extension',
    label: 'Extensão de Navegador',
    badge: 'Chrome & Edge (.zip)',
    badgeHighlight: false,
    icon: Puzzle,
  },
  {
    id: 'advanced',
    label: 'Ajustes & Scripts Python',
    badge: 'Playwright & Proxies',
    badgeHighlight: false,
    icon: Sliders,
  },
];

export function WorkspaceChrome({
  activeTab,
  onSelectTab,
  engineStatus,
  metrics,
  stepsCount,
  activeProxiesCount,
  sseConnected,
  demoMode = false,
  onPrimaryAction,
  children,
}: WorkspaceChromeProps) {
  const getPrimaryCtaLabel = (): { label: string; icon: React.ReactNode; tone: string } => {
    if (engineStatus === 'running') {
      return {
        label: 'Pausar Aprovações',
        icon: <Pause className="w-4 h-4 shrink-0" />,
        tone: 'bg-amber-600 hover:bg-amber-700 text-white',
      };
    }
    if (engineStatus === 'awaiting_challenge') {
      return {
        label: 'Liberar Desafio / MFA',
        icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
        tone: 'bg-blue-600 hover:bg-blue-700 text-white',
      };
    }
    if (engineStatus === 'paused') {
      return {
        label: `Retomar (${metrics.pending + metrics.retrying})`,
        icon: <Play className="w-4 h-4 shrink-0" />,
        tone: 'bg-emerald-600 hover:bg-emerald-700 text-white',
      };
    }
    return {
      label:
        metrics.pending > 0
          ? `Iniciar (${metrics.pending})`
          : 'Reiniciar Fila (418)',
      icon: <Play className="w-4 h-4 shrink-0" />,
      tone: 'bg-blue-600 hover:bg-blue-700 text-white',
    };
  };

  const primaryCta = getPrimaryCtaLabel();

  const [promptModalOpen, setPromptModalOpen] = React.useState(false);

  // No modo estático o motor roda no navegador: não existe Chromium de servidor.
  const localOnly = demoMode || isLocalMode();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <MasterPromptModal isOpen={promptModalOpen} onClose={() => setPromptModalOpen(false)} />
      {demoMode && (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-900">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto py-2 flex items-start sm:items-center gap-2 text-[11px] leading-snug">
            <span className="font-bold shrink-0">Modo local</span>
            <span>
              Servidor de automação não conectado: a gravação, a execução em lote e o navegador
              interno precisam dele. A geração da extensão (.zip) funciona normalmente.
            </span>
          </div>
        </div>
      )}
      {/* Header Fixo com Identidade, Status e Ação Rápida */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-2xs">
        {/* Barra Superior */}
        <div className="h-16 px-4 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectTab('dashboard')}
              className="flex items-center gap-2.5 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-xs shrink-0">
                ⚡
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-base tracking-tight leading-tight">
                    AutoApprove RPA
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Microsoft OAuth Ativo
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                  {metrics.approved} de {metrics.total} aprovados ({metrics.completionPercent.toFixed(0)}%)
                </p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Prompt Perfeito Modal Button */}
            <button
              type="button"
              onClick={() => setPromptModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs cursor-pointer transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Prompt Perfeito</span>
            </button>

            {/* Atalhos Rápidos no Cabeçalho */}
            <button
              type="button"
              onClick={() => onSelectTab('browser')}
              className={`hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                activeTab === 'browser'
                  ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Navegador Interno Real</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </button>

            <button
              type="button"
              onClick={() => {
                void downloadExport('chrome-extension');
              }}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 shadow-2xs cursor-pointer"
            >
              <Puzzle className="w-3.5 h-3.5 text-blue-600" />
              <span>Extensão (.zip)</span>
            </button>

            {/* Status do Robô */}
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 px-3 py-1.5 bg-slate-100 rounded-lg">
              <span className="font-medium text-slate-500">Motor:</span>
              <span className="font-bold text-slate-800 capitalize">
                {engineStatus === 'running'
                  ? 'Executando em Lote'
                  : engineStatus === 'paused'
                  ? 'Pausado'
                  : engineStatus === 'awaiting_challenge'
                  ? 'Aguardando Desafio'
                  : 'Pronto'}
              </span>
            </div>

            {/* Botão Primário de Ação */}
            <button
              type="button"
              onClick={onPrimaryAction}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${primaryCta.tone}`}
            >
              {primaryCta.icon}
              <span>{primaryCta.label}</span>
            </button>
          </div>
        </div>

        {/* Barra de Navegação Horizontal por Abas — DESTAQUE MÁXIMO VISÍVEL */}
        <div className="border-t-2 border-slate-200 bg-white shadow-xs">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto flex items-center gap-2 overflow-x-auto py-2.5">
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-600 scale-[1.02]'
                      : 'text-slate-800 hover:text-blue-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 shadow-2xs'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                    isActive ? 'bg-white text-blue-600' : 'bg-slate-300 text-slate-800'
                  }`}>
                    {index + 1}
                  </span>
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-white' : item.badgeHighlight ? 'text-blue-600' : 'text-slate-600'
                    }`}
                  />
                  <span className="text-sm font-extrabold">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : item.badgeHighlight
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-white text-slate-700 border border-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Faixa Informativa de Contexto da Sessão Real */}
        <div className="bg-slate-900 text-white px-4 py-1.5 border-t border-slate-800 text-[11px]">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={
                  localOnly
                    ? 'w-2 h-2 rounded-full bg-amber-400'
                    : 'w-2 h-2 rounded-full bg-emerald-400 animate-ping'
                }
              />
              <span className={localOnly ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'}>
                {localOnly ? 'Modo local no navegador:' : 'Chromium Real Ativo no Servidor:'}
              </span>
              <span className="text-slate-300">
                {localOnly
                  ? 'o motor roda nesta aba. O Chromium interno exige o servidor local; use a extensão para gravar no portal.'
                  : 'Acesse a aba Navegador Interno Real para autenticar no Microsoft SSO, MFA e gravar a 1ª rodada.'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-slate-400">
              <button
                type="button"
                onClick={() => onSelectTab('browser')}
                className="text-blue-300 hover:text-white underline cursor-pointer font-semibold"
              >
                Abrir Navegador ➔
              </button>
              <span>|</span>
              <button
                type="button"
                onClick={() => {
                  void downloadExport('chrome-extension');
                }}
                className="text-emerald-300 hover:text-white underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3" /> Baixar Extensão (.zip)
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
