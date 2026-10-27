import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CornerDownLeft,
  ExternalLink,
  Eye,
  Globe,
  KeyRound,
  Layers,
  Lock,
  MousePointer,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Trash2,
} from 'lucide-react';
import type {
  AccessRequestItem,
  EngineStatus,
  WorkflowStep,
} from '../types/automation';

interface InternalBrowserViewProps {
  steps: WorkflowStep[];
  queue: AccessRequestItem[];
  engineStatus: EngineStatus;
  activeRequestId: string | null;
  activeStepOrder: number | null;
  targetPortalUrl: string;
  microsoftHint: string;
  onSaveSteps: (nextSteps: WorkflowStep[]) => Promise<{ ok: boolean; error?: string }>;
  onStartExecution: () => void;
  onPauseExecution: () => void;
}

interface BrowserStatus {
  running: boolean;
  url: string;
  title: string;
  executablePath: string;
  hasScreenshot: boolean;
  actionCount: number;
}

interface BrowserActionLog {
  time: string;
  action: string;
  detail: string;
}

interface OpenTab {
  index: number;
  title: string;
  url: string;
  isActive: boolean;
}

export function InternalBrowserView({
  steps,
  queue,
  engineStatus,
  targetPortalUrl,
  microsoftHint,
  onSaveSteps,
}: InternalBrowserViewProps) {
  // Browser state
  const [urlInput, setUrlInput] = useState('http://localhost:3000/iam-portal.html');
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [currentImgSrc, setCurrentImgSrc] = useState<string>('/api/browser/screenshot');
  const [browserMode, setBrowserMode] = useState<'free' | 'record' | 'playback'>('record');
  const [loadingAction, setLoadingAction] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [browserLogs, setBrowserLogs] = useState<BrowserActionLog[]>([]);

  // Auto-refresh control (eliminates constant reloading & flickering!)
  const [autoRefreshActive, setAutoRefreshActive] = useState<boolean>(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(3);
  const [isPreloading, setIsPreloading] = useState<boolean>(false);

  // Microsoft SSO assistant state
  const [ssoEmail, setSsoEmail] = useState<string>('marcel.andre@viavarejo.com.br');
  const [ssoStage, setSsoStage] = useState<string>('idle');
  const [copiedCode, setCopiedCode] = useState(false);

  // Typing bar
  const [typingText, setTypingText] = useState('');

  // Local recorded steps
  const [localSteps, setLocalSteps] = useState<WorkflowStep[]>(steps);
  const [savingSteps, setSavingSteps] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Hover & click visual indicators
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [hoverInspection, setHoverInspection] = useState<{
    tagName: string;
    text: string;
    selector: string;
  } | null>(null);
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const inspectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef<boolean>(false);

  // Sync steps from props
  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  // Smooth, flicker-free screenshot updater (preloads in memory before swapping src)
  const refreshScreenSmooth = useCallback(() => {
    const nextUrl = `/api/browser/screenshot?t=${Date.now()}`;
    setIsPreloading(true);
    const preloader = new Image();
    preloader.onload = () => {
      setCurrentImgSrc(nextUrl);
      setIsPreloading(false);
    };
    preloader.onerror = () => {
      setIsPreloading(false);
    };
    preloader.src = nextUrl;
  }, []);

  // Fetch status, tabs and logs
  const fetchStatusAndTabs = useCallback(async () => {
    try {
      const [statusResp, tabsResp, logsResp] = await Promise.all([
        fetch('/api/browser/status'),
        fetch('/api/browser/pages'),
        fetch('/api/browser/logs'),
      ]);

      if (statusResp.ok) {
        const data = (await statusResp.json()) as BrowserStatus;
        setBrowserStatus(data);
        if (data.url && data.url !== 'about:blank' && !urlInput) {
          setUrlInput(data.url);
        }
      }

      if (tabsResp.ok) {
        const tabsData = (await tabsResp.json()) as { tabs: OpenTab[] };
        setOpenTabs(tabsData.tabs || []);
      }

      if (logsResp.ok) {
        const logsData = (await logsResp.json()) as { logs: BrowserActionLog[] };
        setBrowserLogs(logsData.logs || []);
      }
    } catch {
      // offline / quiet
    }
  }, [urlInput]);

  // Initial load
  useEffect(() => {
    void fetchStatusAndTabs();
    refreshScreenSmooth();
  }, [fetchStatusAndTabs, refreshScreenSmooth]);

  // Periodic polling with user-controlled frequency and NO flicker
  useEffect(() => {
    if (!autoRefreshActive || refreshIntervalSec <= 0) return;

    const interval = setInterval(() => {
      // Do not interrupt user while typing
      if (isTypingRef.current) return;
      void fetchStatusAndTabs();
      refreshScreenSmooth();
    }, refreshIntervalSec * 1000);

    return () => clearInterval(interval);
  }, [autoRefreshActive, refreshIntervalSec, fetchStatusAndTabs, refreshScreenSmooth]);

  const handleNavigate = async (target?: string) => {
    const dest = target || urlInput;
    setLoadingAction(true);
    setStatusMessage(`Navegando para ${dest}...`);
    try {
      const resp = await fetch('/api/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: dest }),
      });
      const data = await resp.json();
      if (data.url) setUrlInput(data.url);
      refreshScreenSmooth();
      void fetchStatusAndTabs();
      setStatusMessage(`✓ Página carregada: ${data.title || dest}`);
    } catch (err) {
      setStatusMessage(`Erro ao navegar: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleSwitchTab = async (index: number) => {
    setLoadingAction(true);
    try {
      const resp = await fetch('/api/browser/switch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      const data = await resp.json();
      if (data.url) setUrlInput(data.url);
      refreshScreenSmooth();
      void fetchStatusAndTabs();
      setStatusMessage(`✓ Alternado para: ${data.title}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleQuickSSO = async () => {
    setLoadingAction(true);
    setStatusMessage('Assistente Microsoft: analisando tela e preenchendo credenciais...');
    try {
      const resp = await fetch('/api/browser/quick-sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ssoEmail }),
      });
      const data = await resp.json();
      setStatusMessage(data.message || 'Comando Microsoft SSO processado.');
      setSsoStage(data.stage || 'done');
      refreshScreenSmooth();
      void fetchStatusAndTabs();
    } catch (err) {
      setStatusMessage(`Erro no SSO Microsoft: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleViewportClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Viewport resolution is 1280x800
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;

    const realX = Math.round(clientX * scaleX);
    const realY = Math.round(clientY * scaleY);

    setClickRipple({ x: clientX, y: clientY, id: Date.now() });
    setTimeout(() => setClickRipple(null), 800);

    setLoadingAction(true);
    try {
      if (browserMode === 'record') {
        setStatusMessage(`Gravando ação em (${realX}, ${realY})...`);
        const resp = await fetch('/api/browser/record-and-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: realX, y: realY }),
        });
        const data = await resp.json();
        if (data.step) {
          setLocalSteps((prev) => [...prev, data.step]);
          setStatusMessage(`✓ Passo gravado: "${data.step.label}" [${data.step.cssSelector}]`);
        }
      } else {
        setStatusMessage(`Clique enviado para (${realX}, ${realY})...`);
        await fetch('/api/browser/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: realX, y: realY }),
        });
        setStatusMessage(`✓ Clique processado no Chromium`);
      }
      refreshScreenSmooth();
      void fetchStatusAndTabs();
    } catch (err) {
      setStatusMessage(`Erro ao processar clique: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    const realX = Math.round(clientX * scaleX);
    const realY = Math.round(clientY * scaleY);

    setHoverCoord({ x: realX, y: realY });

    if (browserMode === 'record') {
      if (inspectTimeoutRef.current) clearTimeout(inspectTimeoutRef.current);
      inspectTimeoutRef.current = setTimeout(async () => {
        try {
          const resp = await fetch('/api/browser/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: realX, y: realY }),
          });
          if (resp.ok) {
            const data = await resp.json();
            setHoverInspection({
              tagName: data.tagName || '',
              text: data.text || '',
              selector: data.selector || '',
            });
          }
        } catch {
          // ignore
        }
      }, 150);
    }
  };

  const handleSendText = async () => {
    if (!typingText.trim()) return;
    setLoadingAction(true);
    try {
      await fetch('/api/browser/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: typingText }),
      });
      setTypingText('');
      refreshScreenSmooth();
      setStatusMessage(`✓ Texto digitado com sucesso no campo focado.`);
    } catch (err) {
      setStatusMessage(`Erro ao digitar texto: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleSendKey = async (key: string) => {
    setLoadingAction(true);
    try {
      await fetch('/api/browser/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      refreshScreenSmooth();
      setStatusMessage(`✓ Tecla "${key}" acionada.`);
    } catch (err) {
      setStatusMessage(`Erro ao enviar tecla: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleBrowserNav = async (action: 'back' | 'forward' | 'reload') => {
    setLoadingAction(true);
    try {
      await fetch(`/api/browser/${action}`, { method: 'POST' });
      refreshScreenSmooth();
      void fetchStatusAndTabs();
    } finally {
      setLoadingAction(false);
    }
  };

  const handleExecuteSingleStep = async (stepOrder: number) => {
    setLoadingAction(true);
    setStatusMessage(`Executando passo #${stepOrder} no Chromium...`);
    try {
      const resp = await fetch('/api/browser/execute-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepOrder }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStatusMessage(`✓ ${data.message}`);
      } else {
        setStatusMessage(`⚠️ ${data.message || data.error}`);
      }
      refreshScreenSmooth();
    } catch (err) {
      setStatusMessage(`Falha ao executar passo: ${String(err)}`);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDeleteStep = (id: string) => {
    setLocalSteps((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return filtered.map((s, idx) => ({ ...s, order: idx + 1 }));
    });
  };

  const handleSaveToWorkflow = async () => {
    setSavingSteps(true);
    setSaveSuccess(false);
    try {
      const res = await onSaveSteps(localSteps);
      if (res.ok) {
        setSaveSuccess(true);
        setStatusMessage('✓ Passos sincronizados com sucesso para o Robô e a Extensão de Navegador!');
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setStatusMessage(`Erro ao salvar: ${res.error || 'Falha de comunicação'}`);
      }
    } finally {
      setSavingSteps(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1520px] w-full mx-auto space-y-6">
      {/* Banner Principal de Orientação */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white rounded-2xl p-5 sm:p-6 shadow-md border border-blue-800/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Navegador Real Chromium Conectado
              </span>
              <span className="text-xs bg-white/10 text-slate-200 px-2.5 py-1 rounded-full">
                Perfil Permanente: {microsoftHint}
              </span>
              <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2.5 py-1 rounded-full">
                Anti-Bot & Stealth Ativo
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              Navegador Interno Real: Treinamento Visual & Login Corporativo
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              Controle o navegador real em tempo real sem recarregar a tela a todo instante. Faça seu login <strong>Microsoft SSO</strong>, aprove o código no celular pelo <strong>Microsoft Authenticator</strong>, e grave o clique do 1º acesso para o robô replicar nas 418 aprovações.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleNavigate('http://localhost:3000/iam-portal.html')}
              className="px-3.5 py-2 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/20 transition-all cursor-pointer flex items-center gap-2"
            >
              <Globe className="w-4 h-4 text-blue-300" />
              <span>Portal IAM Local (418 Itens)</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('https://login.microsoftonline.com/')}
              className="px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>Ir para Microsoft SSO</span>
            </button>
          </div>
        </div>
      </div>

      {/* Assistente Integrado: Login Microsoft & Authenticator (Passo a Passo Simples) */}
      <div className="bg-white border-2 border-blue-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Assistente de Login Microsoft & Autenticador</span>
                <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                  Via Varejo / GPA
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Siga estes 4 botões para autenticar sem dor de cabeça e gravar a sessão no navegador permanente.
              </p>
            </div>
          </div>

          {/* Configuração do E-mail */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 font-medium">E-mail:</span>
            <input
              type="email"
              value={ssoEmail}
              onChange={(e) => setSsoEmail(e.target.value)}
              placeholder="seu.email@viavarejo.com.br"
              className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg text-slate-800 bg-slate-50 focus:bg-white focus:border-blue-500 outline-none w-56 font-mono"
            />
          </div>
        </div>

        {/* Botões do Assistente em Linha */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => handleNavigate('https://login.microsoftonline.com/')}
            disabled={loadingAction}
            className="p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left cursor-pointer transition-all hover:border-blue-300 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-blue-600 uppercase">Passo 1</span>
              <Globe className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600" />
            </div>
            <p className="text-xs font-bold text-slate-800 mt-1">1. Abrir Login Microsoft</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Carrega a página de login oficial</p>
          </button>

          <button
            type="button"
            onClick={handleQuickSSO}
            disabled={loadingAction}
            className="p-2.5 bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200 rounded-xl text-left cursor-pointer transition-all hover:border-blue-400 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-blue-700 uppercase">Passo 2</span>
              <KeyRound className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1">2. Inserir E-mail & Avançar</p>
            <p className="text-[11px] text-slate-600 mt-0.5">Preenche e avança automaticamente</p>
          </button>

          <button
            type="button"
            onClick={() => {
              setAutoRefreshActive(false);
              setStatusMessage('⏸️ Atualização automática pausada para você ler o código do Authenticator com calma.');
            }}
            className="p-2.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-xl text-left cursor-pointer transition-all hover:border-amber-300 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-amber-700 uppercase">Passo 3</span>
              <Smartphone className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1">3. Ver Código Authenticator</p>
            <p className="text-[11px] text-amber-800 mt-0.5">Congela tela para aprovar no celular</p>
          </button>

          <button
            type="button"
            onClick={handleQuickSSO}
            disabled={loadingAction}
            className="p-2.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-xl text-left cursor-pointer transition-all hover:border-emerald-300 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-700 uppercase">Passo 4</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1">4. Manter Conectado (Sim)</p>
            <p className="text-[11px] text-emerald-800 mt-0.5">Salva cookies permanentes</p>
          </button>

          <button
            type="button"
            onClick={() => {
              setAutoRefreshActive(true);
              void handleNavigate(targetPortalUrl || 'http://localhost:3000/iam-portal.html');
            }}
            className="p-2.5 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200 rounded-xl text-left cursor-pointer transition-all hover:border-indigo-300 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-indigo-700 uppercase">Passo 5</span>
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1">5. Voltar ao Portal IAM</p>
            <p className="text-[11px] text-indigo-800 mt-0.5">Inicia aprovação das 418 tarefas</p>
          </button>
        </div>
      </div>

      {/* Grid Principal: Viewport do Chromium + Painel Lateral de Gravação */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Coluna Esquerda: Navegador Real (8 colunas) */}
        <div className="lg:col-span-8 space-y-3">
          {/* Barra de Abas e Controle de Navegação */}
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs space-y-3">
            {/* Lista de Abas Abertas (Suporte a Popups Microsoft) */}
            {openTabs.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 border-b border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase mr-1">Abas:</span>
                {openTabs.map((tab) => (
                  <button
                    key={tab.index}
                    type="button"
                    onClick={() => handleSwitchTab(tab.index)}
                    className={`px-3 py-1 text-xs rounded-lg transition-all flex items-center gap-2 cursor-pointer truncate max-w-[200px] ${
                      tab.isActive
                        ? 'bg-blue-600 text-white font-bold shadow-2xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span className="truncate">{tab.title}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Barra de URL e Navegação */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Voltar"
                  onClick={() => handleBrowserNav('back')}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Avançar"
                  onClick={() => handleBrowserNav('forward')}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Recarregar"
                  onClick={() => handleBrowserNav('reload')}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingAction ? 'animate-spin text-blue-600' : ''}`} />
                </button>
              </div>

              {/* Input de URL */}
              <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onFocus={() => {
                    isTypingRef.current = true;
                  }}
                  onBlur={() => {
                    isTypingRef.current = false;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                  placeholder="URL do portal ou login (ex: https://login.microsoftonline.com)..."
                  className="flex-1 bg-transparent text-xs font-mono text-slate-800 outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleNavigate()}
                  disabled={loadingAction}
                  className="px-2.5 py-1 text-[11px] font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  Navegar
                </button>
              </div>

              {/* Controle de Atualização da Tela (Estabilidade Total) */}
              <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setAutoRefreshActive(!autoRefreshActive)}
                  title={autoRefreshActive ? 'Pausar atualização automática da tela' : 'Ativar atualização automática'}
                  className={`px-2 py-1 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1 ${
                    autoRefreshActive
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 text-slate-700'
                  }`}
                >
                  {autoRefreshActive ? (
                    <>
                      <Pause className="w-3 h-3" />
                      <span>Ao Vivo</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      <span>Pausado</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={refreshScreenSmooth}
                  title="Capturar quadro agora sem piscar"
                  className="p-1 text-slate-700 hover:text-slate-900 rounded cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPreloading ? 'animate-spin text-blue-600' : ''}`} />
                </button>
              </div>
            </div>

            {/* Seleção do Modo de Trabalho */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setBrowserMode('free')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    browserMode === 'free'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MousePointer className="w-3.5 h-3.5 text-blue-600" />
                  <span>Navegação & Login Livre</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowserMode('record')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    browserMode === 'record'
                      ? 'bg-red-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>Modo Gravação (Aprender 1ª Rodada)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowserMode('playback')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    browserMode === 'playback'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Modo Teste</span>
                </button>
              </div>

              {/* Informação do modo */}
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                {browserMode === 'record' ? (
                  <span className="text-red-600 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                    Clique em botões na tela para memorizar o fluxo das 418 aprovações!
                  </span>
                ) : browserMode === 'free' ? (
                  <span className="text-blue-700 font-medium">
                    Navegue livremente para fazer login, resolver Authenticator ou preencher dados.
                  </span>
                ) : (
                  <span className="text-emerald-700 font-medium">
                    Execute os passos salvos no painel direito para validar o robô.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Viewport Estável da Janela do Chromium (SEM RECARREGAR O DOM) */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-300 shadow-sm relative">
            {/* Header da janela com status */}
            <div className="bg-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-300 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/80 inline-block" />
                <span className="font-mono text-[11px] text-slate-300 ml-2 truncate max-w-md">
                  {browserStatus?.title || 'Chromium 124 (Perfil Corporativo Ativo)'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {hoverCoord && (
                  <span className="font-mono text-[11px] text-blue-300 hidden sm:inline">
                    X: {hoverCoord.x} | Y: {hoverCoord.y}
                  </span>
                )}
                <span className="bg-slate-700 px-2 py-0.5 rounded text-[10px] text-slate-200 font-medium">
                  {browserMode === 'record' ? 'GRAVAÇÃO ATIVA' : 'NAVEGAÇÃO INTERATIVA'}
                </span>
              </div>
            </div>

            {/* Container da Imagem Única e Estável */}
            <div
              ref={imageContainerRef}
              onClick={handleViewportClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => {
                setHoverCoord(null);
                setHoverInspection(null);
              }}
              className="relative w-full aspect-[16/10] bg-slate-950 cursor-crosshair overflow-hidden select-none"
            >
              {/* O elemento <img> NÃO possui atributo key para evitar unmount e flickering! */}
              <img
                src={currentImgSrc}
                alt="Janela do Navegador Chromium Real"
                className="w-full h-full object-contain pointer-events-none transition-opacity duration-150"
              />

              {/* Ripple de clique visual */}
              {clickRipple && (
                <div
                  className="absolute pointer-events-none w-8 h-8 rounded-full border-2 border-red-500 bg-red-500/20 animate-ping -translate-x-1/2 -translate-y-1/2"
                  style={{ left: clickRipple.x, top: clickRipple.y }}
                />
              )}

              {/* Tooltip de Inspeção de Elemento ao passar o mouse */}
              {browserMode === 'record' && hoverInspection && hoverInspection.selector && (
                <div className="absolute bottom-3 left-3 right-3 bg-slate-900/95 backdrop-blur-xs text-white p-2.5 rounded-xl border border-slate-700 shadow-lg text-xs pointer-events-none flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-1.5 py-0.5 bg-red-600 rounded text-[10px] font-bold uppercase">
                      {hoverInspection.tagName}
                    </span>
                    <span className="font-mono text-blue-300 truncate text-[11px]">
                      {hoverInspection.selector}
                    </span>
                    {hoverInspection.text && (
                      <span className="text-slate-400 truncate max-w-xs">
                        &quot;{hoverInspection.text}&quot;
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-400 shrink-0">
                    Clique para Gravar no Fluxo
                  </span>
                </div>
              )}

              {/* Indicador de carregamento */}
              {loadingAction && (
                <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-2xs flex items-center justify-center">
                  <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg border border-slate-700 flex items-center gap-3 text-xs font-semibold">
                    <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                    <span>Processando ação no Chromium...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Barra de Digitação & Teclado Virtual (Para Login, Senhas, OTPs) */}
            <div className="bg-slate-800 p-3 border-t border-slate-700 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <CornerDownLeft className="w-3.5 h-3.5 text-blue-400" />
                Digitar na Página:
              </span>
              <div className="flex-1 min-w-[200px] flex items-center gap-1.5 bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-1">
                <input
                  type="text"
                  value={typingText}
                  onChange={(e) => setTypingText(e.target.value)}
                  onFocus={() => {
                    isTypingRef.current = true;
                  }}
                  onBlur={() => {
                    isTypingRef.current = false;
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Digite texto (login, senha ou número do Authenticator)..."
                  className="flex-1 bg-transparent text-xs text-white outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendText}
                  disabled={!typingText.trim() || loadingAction}
                  className="px-2 py-0.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer disabled:opacity-40"
                >
                  Digitar
                </button>
              </div>

              {/* Teclas de Ação Rápida */}
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleSendKey('Enter')}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-mono cursor-pointer"
                >
                  ↵ Enter
                </button>
                <button
                  type="button"
                  onClick={() => handleSendKey('Tab')}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-mono cursor-pointer"
                >
                  ⇥ Tab
                </button>
                <button
                  type="button"
                  onClick={() => handleSendKey('Backspace')}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-mono cursor-pointer"
                >
                  ⌫ Backspace
                </button>
                <button
                  type="button"
                  onClick={() => handleSendKey('Escape')}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-mono cursor-pointer"
                >
                  ⎋ Esc
                </button>
              </div>
            </div>
          </div>

          {/* Mensagem de Feedback de Ação */}
          {statusMessage && (
            <div className="bg-slate-100 border border-slate-200 text-slate-800 text-xs px-3.5 py-2 rounded-xl flex items-center justify-between">
              <span>{statusMessage}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Coluna Direita: Fluxo Gravado & Logs do Chromium (4 colunas) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card de Passos Gravados da 1ª Rodada */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>Passos Aprendidos ({localSteps.length})</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Sequência repetida automaticamente para os 418 acessos
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveToWorkflow}
                disabled={savingSteps}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                  saveSuccess
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingSteps ? 'Salvando...' : saveSuccess ? 'Salvo ✓' : 'Salvar Fluxo'}</span>
              </button>
            </div>

            {/* Lista de Passos */}
            <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
              {localSteps.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs space-y-2 border-2 border-dashed border-slate-200 rounded-xl">
                  <MousePointer className="w-6 h-6 mx-auto text-slate-300" />
                  <p>Nenhum passo gravado ainda.</p>
                  <p className="text-[11px] text-slate-500">
                    Ative o <strong>Modo Gravação</strong> e clique nos elementos na janela do navegador ao lado.
                  </p>
                </div>
              ) : (
                localSteps.map((step) => (
                  <div
                    key={step.id}
                    className="p-3 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl transition-all space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                          {step.order}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate leading-tight">
                            {step.label}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500 truncate">
                            {step.cssSelector}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Testar este passo agora no Chromium"
                          onClick={() => handleExecuteSingleStep(step.order)}
                          className="p-1 text-slate-500 hover:text-blue-600 hover:bg-white rounded cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Remover passo"
                          onClick={() => handleDeleteStep(step.id)}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-white rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-200/60 pt-1.5">
                      <span className="uppercase font-semibold text-slate-600">
                        Ação: {step.action}
                      </span>
                      <span>Espera: {step.waitBeforeMs}ms</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Dica de Aprendizado */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                Sincronização Automática:
              </p>
              <p className="text-blue-800 leading-relaxed">
                Cada clique gravado aqui é exportado automaticamente tanto para a <strong>Extensão de Navegador (.zip)</strong> quanto para o <strong>Script Python Playwright</strong>.
              </p>
            </div>
          </div>

          {/* Logs do Chromium em Tempo Real */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xs text-white space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Logs do Chromium em Tempo Real</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {browserLogs.length} eventos
              </span>
            </div>

            <div className="bg-slate-950 rounded-xl p-2.5 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto space-y-1">
              {browserLogs.length === 0 ? (
                <p className="text-slate-600 text-center py-4">Aguardando eventos do Chromium...</p>
              ) : (
                browserLogs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="text-slate-500 shrink-0">{log.time}</span>
                    <span className="text-blue-400 font-semibold shrink-0">[{log.action}]</span>
                    <span className="text-slate-300 break-all">{log.detail}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
