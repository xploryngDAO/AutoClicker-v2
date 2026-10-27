import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  KeyRound,
  Layers,
  MousePointerClick,
  Pin,
  Play,
  PlusCircle,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { AutomationConfig, AutomationTask, WorkflowStep } from '../types/automation';
import { getDefaultTasks } from '../lib/seedData';
import {
  buildChromeExtensionZipEntries,
  generateChromeExtensionTextFiles,
} from '../lib/codeGenerators';
import { createZipArchive } from '../lib/zipBuilder';

interface ExtensionStudioViewProps {
  config: AutomationConfig;
  steps: WorkflowStep[];
}

export function ExtensionStudioView({ config, steps }: ExtensionStudioViewProps) {
  const extensionFiles = useMemo(
    () => generateChromeExtensionTextFiles(config, steps),
    [config, steps]
  );

  const initialTasks = useMemo(() => {
    const list = getDefaultTasks();
    if (steps && steps.length > 0) {
      const iam = list.find((t) => t.id === 'task-iam-approvals');
      if (iam) iam.steps = steps;
    }
    return list;
  }, [steps]);

  const [tasks, setTasks] = useState<AutomationTask[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('task-free-recorder');
  const [selectedFilename, setSelectedFilename] = useState<string>('manifest.json');
  const [copied, setCopied] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [showTechnicalCode, setShowTechnicalCode] = useState(false);

  const activeTask = tasks.find((t) => t.id === selectedTaskId) || tasks[0];

  // Simulador Interativo
  const [simState, setSimState] = useState<'idle' | 'running' | 'paused'>('idle');
  const [simActivePhase, setSimActivePhase] = useState<1 | 2 | 3 | 4>(1);
  const [simActiveStepIdx, setSimActiveStepIdx] = useState<number>(0);
  const [simCurrentItem, setSimCurrentItem] = useState(1);
  const [simCurrentPage, setSimCurrentPage] = useState(1);
  const [simApprovedCount, setSimApprovedCount] = useState(0);
  const [simLogs, setSimLogs] = useState<Array<{ time: string; text: string; phase: string }>>([
    {
      time: '10:00:00',
      text: 'Extensão pronta para executar ou gravar qualquer automação corporativa.',
      phase: 'Pronto',
    },
  ]);

  const activeFile =
    extensionFiles.find((f) => f.filename === selectedFilename) || extensionFiles[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Safe fallback
    }
  };

  const handleDownloadZip = () => {
    try {
      const entries = buildChromeExtensionZipEntries(config, steps);
      const zipBytes = createZipArchive(entries);
      const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'autoapprove-extensao-chrome-mv3.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);
    } catch {
      window.location.href = '/api/export/chrome-extension';
    }
  };

  // Simulação Interativa da Tarefa Selecionada
  const runSimCycle = () => {
    if (simState === 'running') return;
    setSimState('running');
    const isTableLoop =
      activeTask.pattern === 'list_detail_pagination' || activeTask.repeatMode === 'loop_list';

    if (isTableLoop) {
      // Simula o loop de 4 fases
      let phase = 1;
      let item = simCurrentItem;
      let page = simCurrentPage;
      let approved = simApprovedCount;

      const interval = setInterval(() => {
        const timeStr = new Date().toLocaleTimeString('pt-BR');

        if (phase === 1) {
          setSimActivePhase(1);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `[Fase 1: Lista] Clicando no item #${item} (IAM-2026-${String(item).padStart(4, '0')})...`,
              phase: 'Fase 1',
            },
            ...prev.slice(0, 25),
          ]);
          phase = 2;
        } else if (phase === 2) {
          setSimActivePhase(2);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `[Fase 2: Detalhe] Marcando LGPD, vigência 90d e confirmando aprovação.`,
              phase: 'Fase 2',
            },
            ...prev.slice(0, 25),
          ]);
          approved += 1;
          setSimApprovedCount(approved);
          phase = 3;
        } else if (phase === 3) {
          setSimActivePhase(3);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `[Fase 3: Retorno] Retornando à lista principal com history.back().`,
              phase: 'Fase 3',
            },
            ...prev.slice(0, 25),
          ]);

          item += 1;
          setSimCurrentItem(item);

          if (item % 10 === 1 && item > 1) {
            phase = 4;
          } else {
            phase = 1;
          }
        } else if (phase === 4) {
          setSimActivePhase(4);
          page += 1;
          setSimCurrentPage(page);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `[Fase 4: Paginação] 10 itens concluídos nesta página! Clicando em 'Próxima Página' -> Avançando para Página ${page}.`,
              phase: 'Fase 4',
            },
            ...prev.slice(0, 25),
          ]);
          phase = 1;
        }

        if (approved >= 30) {
          clearInterval(interval);
          setSimState('idle');
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `✓ Simulação concluída com sucesso! 30 itens processados em lote.`,
              phase: 'Fim',
            },
            ...prev.slice(0, 25),
          ]);
        }
      }, 650);

      return () => clearInterval(interval);
    } else {
      // Simula a Macro Livre ou Formulário passo a passo
      const taskSteps =
        activeTask.steps && activeTask.steps.length > 0
          ? activeTask.steps
          : [
              {
                id: 's1',
                order: 1,
                label: 'Acessar menu principal do sistema corporativo',
                action: 'click',
                cssSelector: 'button#menu-principal',
                ariaSelector: 'role=button',
                waitBeforeMs: 300,
                timeoutMs: 5000,
                isLoopTarget: false,
              },
              {
                id: 's2',
                order: 2,
                label: 'Preencher filtro de busca ou parâmetro da rotina',
                action: 'fill',
                value: '2026-Q1-CORP',
                cssSelector: 'input#campo-busca',
                ariaSelector: 'role=textbox',
                waitBeforeMs: 250,
                timeoutMs: 5000,
                isLoopTarget: false,
              },
              {
                id: 's3',
                order: 3,
                label: 'Clicar em Executar / Processar Ação',
                action: 'click',
                cssSelector: 'button[data-action="executar"]',
                ariaSelector: 'role=button',
                waitBeforeMs: 350,
                timeoutMs: 8000,
                isLoopTarget: false,
              },
            ];

      let stepIdx = 0;
      const interval = setInterval(() => {
        const timeStr = new Date().toLocaleTimeString('pt-BR');
        if (stepIdx < taskSteps.length) {
          const cur = taskSteps[stepIdx];
          setSimActiveStepIdx(stepIdx);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `[Passo ${stepIdx + 1}/${taskSteps.length}] Executando: ${cur.label} (${cur.action.toUpperCase()} em ${cur.cssSelector})`,
              phase: `Passo ${stepIdx + 1}`,
            },
            ...prev.slice(0, 25),
          ]);
          stepIdx += 1;
        } else {
          clearInterval(interval);
          setSimState('idle');
          setSimApprovedCount((prev) => prev + 1);
          setSimLogs((prev) => [
            {
              time: timeStr,
              text: `✓ Tarefa "${activeTask.name}" executada com sucesso! Todos os passos concluídos.`,
              phase: 'Fim',
            },
            ...prev.slice(0, 25),
          ]);
        }
      }, 750);

      return () => clearInterval(interval);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header com Botões de Download */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <span>Extensão Universal para Chrome e Edge</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
              Multi-Tarefas & Gravação Livre
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Roda no seu próprio navegador corporativo com sua sessão Microsoft 365 / Authenticator já conectada. Suporta qualquer aplicação web (SAP, Totvs, Jira, ServiceNow, relatórios ou aprovações em massa).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadZip}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{downloadSuccess ? 'Baixando Arquivo (.zip)...' : 'Baixar Extensão (.zip)'}</span>
          </button>

          <a
            href="/api/export/chrome-extension"
            download="autoapprove-extensao-chrome-mv3.zip"
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-2xs transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Link Direto</span>
          </a>
        </div>
      </div>

      {/* Resposta Clara à Pergunta do Usuário sobre Flexibilidade */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 bg-blue-600/40 text-blue-300 rounded-xl shrink-0 border border-blue-400/30">
            <Wand2 className="w-6 h-6 text-blue-300" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>A Extensão NÃO está limitada a apenas 4 fases!</span>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[11px] px-2.5 py-0.5 rounded-full font-semibold">
                Motor RPA Universal Ativo
              </span>
            </h2>
            <p className="text-xs text-blue-100 leading-relaxed max-w-4xl">
              Você pode ensinar o robô a realizar <strong>qualquer rotina web corporativa</strong> (SAP, Totvs, Jira, ServiceNow, Salesforce, downloads de relatórios ou cadastros). O sistema possui dois modos de operação:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl p-4 space-y-2">
            <strong className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              1. Modo Gravação Livre Universal (Qualquer Aplicação):
            </strong>
            <p className="text-xs text-blue-100 leading-relaxed">
              Você aciona a gravação ao vivo na página web. O robô aprende <strong>cada clique, digitação em campos, seleção de listas ou marcação de checkboxes</strong> exatamente como você realizou na tela, criando seletores CSS/ARIA ultra-resilientes. Pode ser repetido 1x, N vezes ou continuamente!
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl p-4 space-y-2">
            <strong className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              2. Modo Estruturado para Lotes em Tabela (4 Fases):
            </strong>
            <p className="text-xs text-blue-100 leading-relaxed">
              Ideal para quando você tiver uma tabela com 400+ itens: ele clica na linha, entra na subpágina de aprovação, confirma, volta automaticamente para a lista principal e vira de página a cada X itens até concluir o lote inteiro!
            </p>
          </div>
        </div>

        {/* Notificações de Resiliência Multi-Páginas, Auto-Wait e Disparo de Dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">🛡️</span>
            <div>
              <strong className="text-xs font-bold text-emerald-200 block">
                Gravação Blindada Multi-Páginas
              </strong>
              <p className="text-[11px] text-emerald-100/80 leading-relaxed mt-0.5">
                Ao clicar em links ou botões que mudam de página ou recarregam a aba, o modal da extensão <strong>não fecha</strong> e a gravação continua ativa sem perda de nenhum passo.
              </p>
            </div>
          </div>

          <div className="bg-amber-950/60 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">⚡</span>
            <div>
              <strong className="text-xs font-bold text-amber-200 block">
                Auto-Wait & Estabilização do DOM
              </strong>
              <p className="text-[11px] text-amber-100/80 leading-relaxed mt-0.5">
                Cliques e digitações agora <strong>aguardam o término de spinners, requisições AJAX e mutações do DOM</strong> antes de prosseguir para o próximo passo. Nunca atropela ações lentas!
              </p>
            </div>
          </div>

          <div className="bg-blue-950/60 border border-blue-500/40 rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">🎯</span>
            <div>
              <strong className="text-xs font-bold text-blue-200 block">
                Disparo Universal de Dropdowns & Combos
              </strong>
              <p className="text-[11px] text-blue-100/80 leading-relaxed mt-0.5">
                Caixas de seleção e dropdowns (Radix, React-Select, Ant Design, MUI, HTML5) abrem garantidamente com <strong>PointerEvents em coordenadas centrais</strong> e ativadores WAI-ARIA / showPicker().
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Central de Automações & Biblioteca de Tarefas */}
      <div className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <span>Biblioteca de Automações Pré-Configuradas & Prontas para Uso</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Alterne entre diferentes rotinas salvas na extensão ou grave uma nova tarefa personalizada com cliques livres.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runSimCycle}
              disabled={simState === 'running'}
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>{simState === 'running' ? 'Simulando Execução...' : 'Simular Esta Automação'}</span>
            </button>
          </div>
        </div>

        {/* Grade de 4 Tarefas Pré-Configuradas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
          {tasks.map((task) => {
            const isSelected = selectedTaskId === task.id;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  setSelectedTaskId(task.id);
                  setSimApprovedCount(0);
                }}
                className={`text-left p-4 rounded-xl border-2 transition-all cursor-pointer space-y-2.5 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/70 shadow-sm ring-2 ring-blue-100'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100/70 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      task.pattern === 'list_detail_pagination'
                        ? 'bg-blue-600 text-white'
                        : task.pattern === 'form_submission'
                        ? 'bg-purple-600 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {task.pattern === 'list_detail_pagination'
                      ? 'Lote em Tabela'
                      : task.pattern === 'form_submission'
                      ? 'Formulário'
                      : 'Macro Livre'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-semibold">{task.steps.length} passos</span>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-900 leading-snug">{task.name}</h3>
                  <p className="text-[11px] text-slate-600 line-clamp-2 mt-1">{task.description}</p>
                </div>

                <div className="pt-1 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span>{task.category}</span>
                  <span className="font-bold text-blue-700">
                    {task.repeatMode === 'loop_list'
                      ? 'Loop 418 itens'
                      : task.repeatMode === 'repeat_n'
                      ? `Repetir ${task.repeatCount}x`
                      : 'Executar 1x'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detalhes da Tarefa Selecionada */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase text-blue-700">Tarefa Ativa Selecionada:</span>
              <h3 className="text-sm font-bold text-slate-900">{activeTask.name}</h3>
              <p className="text-xs text-slate-600">{activeTask.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700">
                Modo: {activeTask.repeatMode === 'loop_list' ? 'Loop de Lista / Tabela' : activeTask.repeatMode === 'repeat_n' ? `Repetição N vezes (${activeTask.repeatCount}x)` : 'Execução Única (1x)'}
              </span>
            </div>
          </div>

          {/* Passos da Tarefa Ativa */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 mb-2">Passos Gravados Nesta Rotina:</h4>
            {activeTask.steps && activeTask.steps.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {activeTask.steps.map((st, i) => (
                  <div
                    key={st.id || i}
                    className={`p-2.5 bg-white border rounded-lg text-xs space-y-1 transition-all ${
                      simState === 'running' && simActiveStepIdx === i
                        ? 'border-emerald-500 ring-2 ring-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500">#{i + 1} [{st.action.toUpperCase()}]</span>
                      <span className="text-[10px] font-mono text-slate-400">{st.waitBeforeMs}ms</span>
                    </div>
                    <strong className="text-slate-900 block text-[11px] truncate">{st.label}</strong>
                    <code className="text-[10px] font-mono text-blue-700 bg-slate-50 px-1 py-0.5 rounded block truncate">
                      {st.cssSelector}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-white border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 text-center">
                Esta macro está pronta para aprender com você! Abra a página da tarefa e clique em &quot;Gravar na Tela&quot;.
              </div>
            )}
          </div>
        </div>

        {/* Telemetria da Simulação */}
        <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-300 space-y-2 border border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-[11px]">
            <span className="text-slate-400 font-bold flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${simState === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              Telemetria em Tempo Real da Automação:
            </span>
            <div className="flex items-center gap-4 text-slate-300">
              <span>Status: <strong className="text-emerald-400">{simState === 'running' ? 'Executando' : 'Pronto'}</strong></span>
              <span>Ciclos / Itens Concluídos: <strong className="text-purple-400">{simApprovedCount}</strong></span>
            </div>
          </div>

          <div className="max-h-28 overflow-y-auto space-y-1 text-[11px]">
            {simLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-slate-500 shrink-0">{log.time}</span>
                <span className="text-blue-400 font-semibold shrink-0">[{log.phase}]</span>
                <span className="text-slate-200">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Explicação Direta do Erro de Acesso Condicional da Microsoft */}
      <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-amber-600 text-white rounded-xl shrink-0 shadow-xs">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-bold text-amber-950">
              Por que ocorreu o erro: &quot;No momento, não é possível acessar esta opção. Sua entrada teve êxito, mas não corresponde aos critérios para acessar este recurso...&quot;?
            </h2>
            <p className="text-xs text-amber-900 leading-relaxed">
              Esse bloqueio é a <strong>Política de Acesso Condicional do Microsoft Entra ID (Azure AD)</strong> configurada pela segurança da informação da sua empresa (Via Varejo / GPA). O administrador exige dois critérios que apenas o seu computador físico possui:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="bg-white/90 border border-amber-200 rounded-xl p-3.5 space-y-1.5 text-xs">
            <strong className="text-amber-950 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              1. Restrição de Dispositivo (Intune / Device Compliance):
            </strong>
            <p className="text-slate-600">
              O servidor na nuvem não possui o certificado digital corporativo nem está registrado no Intune da organização. Por isso, a Microsoft recusa o token no servidor em nuvem.
            </p>
          </div>

          <div className="bg-white/90 border border-amber-200 rounded-xl p-3.5 space-y-1.5 text-xs">
            <strong className="text-emerald-950 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              2. Por que a Extensão no seu Computador é a Solução Perfeita:
            </strong>
            <p className="text-slate-600">
              No seu computador de trabalho, seu Chrome ou Edge <strong>já possui todos os certificados corporativos e está na rede/VPN autorizada</strong>. Você faz o login normal sem erro algum, e a extensão roda as aprovações repetitivas dentro da sua sessão válida!
            </p>
          </div>
        </div>
      </div>

      {/* Guia de Instalação no Chrome / Edge do Usuário */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Puzzle className="w-5 h-5 text-blue-600" />
          <span>Como instalar a extensão no seu Chrome ou Edge em 3 minutos</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">1</span>
            <strong className="text-slate-900 block text-sm">Baixe o Arquivo .ZIP</strong>
            <p className="text-slate-600">
              Clique no botão azul no topo da tela para baixar o arquivo <code className="bg-white px-1 py-0.5 border rounded">autoapprove-extensao-chrome-mv3.zip</code>.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">2</span>
            <strong className="text-slate-900 block text-sm">Descompacte a Pasta</strong>
            <p className="text-slate-600">
              Extraia os arquivos em qualquer pasta do seu computador corporativo (ex: em Documentos ou na Área de Trabalho).
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">3</span>
            <strong className="text-slate-900 block text-sm">Abra chrome://extensions</strong>
            <p className="text-slate-600">
              No Chrome ou Edge, digite <code className="bg-white px-1 py-0.5 border rounded">chrome://extensions</code>, ative o <strong>Modo do desenvolvedor</strong> e clique em <strong>&quot;Carregar sem compactação&quot;</strong>.
            </p>
          </div>

          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
            <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">4</span>
            <strong className="text-emerald-950 block text-sm">Abra a Barra Flutuante!</strong>
            <p className="text-emerald-900">
              Acesse o portal da empresa com sua conta já logada. Clique no ícone do AutoApprove, selecione a tarefa ou grave uma nova na tela e deixe o robô trabalhar!
            </p>
          </div>
        </div>
      </div>

      {/* Código Fonte Técnico Opcional */}
      <div className="pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setShowTechnicalCode((prev) => !prev)}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <Code2 className="w-4 h-4 text-slate-400" />
          <span>Ver código-fonte dos arquivos da extensão (Opcional)</span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${
              showTechnicalCode ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showTechnicalCode && (
          <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Arquivos da extensão"
                className="flex flex-wrap items-center gap-1 p-1 bg-slate-800 rounded-lg"
              >
                {extensionFiles.map((file) => (
                  <button
                    key={file.filename}
                    role="tab"
                    aria-selected={selectedFilename === file.filename}
                    type="button"
                    onClick={() => setSelectedFilename(file.filename)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedFilename === file.filename
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {file.filename}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="px-5 py-2.5 bg-slate-950 border-b border-slate-800 text-xs text-slate-400">
              {activeFile.description}
            </div>

            <pre className="p-5 overflow-x-auto max-h-[420px] text-xs font-mono leading-relaxed text-slate-100">
              <code>{activeFile.content}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
