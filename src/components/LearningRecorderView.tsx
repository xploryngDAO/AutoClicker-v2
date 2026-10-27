import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleDot,
  KeyRound,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type { StepActionType, WorkflowStep } from '../types/automation';
import { getDefaultWorkflowSteps, synthesizeRecordedStep } from '../lib/seedData';

interface LearningRecorderViewProps {
  steps: WorkflowStep[];
  targetPortalUrl: string;
  microsoftHint: string;
  onSaveSteps: (nextSteps: WorkflowStep[]) => Promise<{ ok: boolean; error?: string }>;
}

interface SandboxSampleRow {
  id: string;
  requester: string;
  system: string;
  role: string;
  approved: boolean;
}

const INITIAL_SANDBOX_ROWS: SandboxSampleRow[] = [
  {
    id: 'IAM-2026-0001',
    requester: 'Mariana Costa',
    system: 'SAP S/4HANA Produção',
    role: 'Leitura Razão Contábil (FI-GL)',
    approved: false,
  },
  {
    id: 'IAM-2026-0002',
    requester: 'Rafael Almeida',
    system: 'Azure Databricks Lakehouse',
    role: 'Workspace Consumer · Vendas',
    approved: false,
  },
  {
    id: 'IAM-2026-0003',
    requester: 'Camila Oliveira',
    system: 'Microsoft Entra ID · Grupos',
    role: 'Operador Catálogo B2B',
    approved: false,
  },
];

export function LearningRecorderView({
  steps,
  targetPortalUrl,
  microsoftHint,
  onSaveSteps,
}: LearningRecorderViewProps) {
  const [draftSteps, setDraftSteps] = useState<WorkflowStep[]>(steps);
  const [isRecording, setIsRecording] = useState(false);
  const [oauthAuthenticated, setOauthAuthenticated] = useState(true);
  const [mfaCodeSelected, setMfaCodeSelected] = useState<string | null>(null);

  const [sandboxRows, setSandboxRows] = useState<SandboxSampleRow[]>(INITIAL_SANDBOX_ROWS);
  const [selectedRowId, setSelectedRowId] = useState<string>('IAM-2026-0001');
  const [policyChecked, setPolicyChecked] = useState(false);
  const [grantDuration, setGrantDuration] = useState('90d');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const [newStepLabel, setNewStepLabel] = useState('');
  const [newStepAction, setNewStepAction] = useState<StepActionType>('click');
  const [newStepSelector, setNewStepSelector] = useState('');
  const [newStepValue, setNewStepValue] = useState('');
  const [formMessage, setFormMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const lastInteractionTs = useRef<number>(Date.now());

  const recordStepIfActive = (params: {
    label: string;
    action: StepActionType;
    tagName: string;
    dataAction?: string;
    dataTestId?: string;
    ariaLabel?: string;
    value?: string;
  }) => {
    if (!isRecording) return;
    const now = Date.now();
    const elapsed = now - lastInteractionTs.current;
    lastInteractionTs.current = now;

    setDraftSteps((prev) => {
      const synthesized = synthesizeRecordedStep(
        {
          ...params,
          elapsedSincePrevMs: elapsed,
        },
        prev.length + 1
      );
      return [...prev, synthesized];
    });
  };

  const handleStartFreshRecording = () => {
    setDraftSteps([]);
    setSandboxRows(INITIAL_SANDBOX_ROWS);
    setSelectedRowId('IAM-2026-0001');
    setPolicyChecked(false);
    setGrantDuration('90d');
    setConfirmModalOpen(false);
    lastInteractionTs.current = Date.now();
    setIsRecording(true);
    setFormMessage(null);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= draftSteps.length) return;
    const copy = [...draftSteps];
    const [removed] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, removed);
    setDraftSteps(copy.map((s, idx) => ({ ...s, order: idx + 1 })));
  };

  const handleDeleteStep = (id: string) => {
    setDraftSteps((prev) =>
      prev.filter((s) => s.id !== id).map((s, idx) => ({ ...s, order: idx + 1 }))
    );
  };

  const handleSelectorEdit = (id: string, nextSelector: string) => {
    setDraftSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, cssSelector: nextSelector } : s))
    );
  };

  const handleAddCustomStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStepLabel.trim() || !newStepSelector.trim()) {
      setFormMessage({
        type: 'err',
        text: 'Informe a descrição do passo e o seletor CSS antes de adicionar.',
      });
      return;
    }

    const added: WorkflowStep = {
      id: `custom-${Date.now().toString(36)}`,
      order: draftSteps.length + 1,
      label: newStepLabel.trim(),
      action: newStepAction,
      cssSelector: newStepSelector.trim(),
      ariaSelector: newStepSelector.trim(),
      value: newStepValue.trim() || undefined,
      waitBeforeMs: 300,
      timeoutMs: 6000,
      isLoopTarget: true,
    };
    setDraftSteps((prev) => [...prev, added]);
    setNewStepLabel('');
    setNewStepSelector('');
    setNewStepValue('');
    setFormMessage(null);
  };

  const handleApplyToBatch = async () => {
    if (draftSteps.length === 0) {
      setFormMessage({
        type: 'err',
        text: 'Grave ou adicione pelo menos 1 passo antes de aplicar o modelo ao lote.',
      });
      return;
    }
    setIsRecording(false);
    const res = await onSaveSteps(draftSteps);
    if (res.ok) {
      setFormMessage({
        type: 'ok',
        text: `Modelo com ${draftSteps.length} passos aplicado! Scripts Python e Extensão MV3 atualizados.`,
      });
    } else {
      setFormMessage({
        type: 'err',
        text: res.error || 'Falha ao salvar os passos.',
      });
    }
  };

  const activeSandboxRow = sandboxRows.find((r) => r.id === selectedRowId) || sandboxRows[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Modo Aprendizado — Gravação da 1ª Rodada
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Demonstre como aprovar uma única solicitação no ambiente espelhado abaixo ou edite os seletores CSS diretamente. O sistema parametriza o loop para replicar a mesma sequência nas 400+ concessões.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isRecording ? (
            <button
              type="button"
              onClick={handleStartFreshRecording}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <CircleDot className="w-4 h-4" />
              <span>Iniciar Gravação da 1ª Rodada</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopRecording}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Concluir Gravação ({draftSteps.length} passos)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsRecording(false);
              setDraftSteps(getDefaultWorkflowSteps());
              setFormMessage(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar Padrão</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive Target Portal Sandbox (7 cols) */}
        <section
          aria-label="Ambiente de demonstração da primeira rodada"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 bg-slate-900 text-slate-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-white whitespace-nowrap">Janela Espelho</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono text-slate-300 truncate">{targetPortalUrl}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setOauthAuthenticated((prev) => !prev);
                setMfaCodeSelected(null);
              }}
              className="text-xs font-medium text-blue-300 hover:text-white underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              {oauthAuthenticated ? 'Testar Login Microsoft OAuth' : 'Pular para Sessão Logada'}
            </button>
          </div>

          {isRecording && (
            <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 text-xs text-blue-900 flex items-center justify-between gap-2">
              <span className="font-medium">
                Gravação ativa: clique em uma linha pendente, marque o aceite, selecione a vigência e aprove para ensinar a sequência.
              </span>
              <span className="font-mono tabular-nums font-semibold shrink-0">
                {draftSteps.length} capturados
              </span>
            </div>
          )}

          {!oauthAuthenticated ? (
            <div className="p-8 max-w-md mx-auto space-y-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <KeyRound className="w-4 h-4 text-blue-600" />
                  <span>Microsoft Entra ID · Autenticação Corporativa</span>
                </div>
                <p className="text-xs text-slate-600">
                  Conta detectada: <strong className="font-mono">{microsoftHint}</strong>
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-center">
                <p className="text-xs text-slate-600">
                  Abra seu app <strong>Microsoft Authenticator</strong> e aprove a solicitação tocando no número abaixo:
                </p>
                <p className="text-3xl font-bold font-mono tabular-nums text-slate-900 py-1">
                  84
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-700">
                  Simular confirmação no autenticador móvel:
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {['39', '84', '61'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setMfaCodeSelected(num);
                        if (num === '84') {
                          setOauthAuthenticated(true);
                        }
                      }}
                      className="py-2.5 text-sm font-mono tabular-nums font-semibold bg-white border border-slate-200 hover:border-blue-600 rounded-lg cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}
                </div>
                {mfaCodeSelected && mfaCodeSelected !== '84' && (
                  <p className="text-xs text-red-600">
                    Número incorreto selecionado. Toque em 84 para autenticar e persistir o token OAuth.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Portal de Governança IAM — Solicitações Aguardando Aprovação
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Passo 1: Selecione a primeira linha pendente na tabela abaixo.
                </p>
              </div>

              <div className="overflow-x-auto border-t border-b border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                      <th className="py-2 pr-3">ID</th>
                      <th className="py-2 px-3">Colaborador</th>
                      <th className="py-2 px-3">Sistema / Perfil</th>
                      <th className="py-2 pl-3 text-right">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sandboxRows.map((r) => {
                      const isSelected = r.id === selectedRowId;
                      return (
                        <tr
                          key={r.id}
                          data-request-status={r.approved ? 'approved' : 'pending'}
                          onClick={() => {
                            if (r.approved) return;
                            setSelectedRowId(r.id);
                            recordStepIfActive({
                              label: 'Selecionar linha da solicitação pendente na grade',
                              action: 'click',
                              tagName: 'tr',
                              dataTestId: 'pending-access-row',
                              ariaLabel: `Linha de solicitação ${r.id}`,
                            });
                          }}
                          className={`transition-colors ${
                            r.approved
                              ? 'opacity-55 bg-slate-50'
                              : isSelected
                                ? 'bg-blue-50/80 cursor-pointer'
                                : 'hover:bg-slate-50 cursor-pointer'
                          }`}
                        >
                          <td className="py-2.5 pr-3 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={r.approved}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRowId(r.id);
                                recordStepIfActive({
                                  label: 'Selecionar linha da solicitação pendente na grade',
                                  action: 'click',
                                  tagName: 'tr',
                                  dataTestId: 'pending-access-row',
                                  ariaLabel: `Linha de solicitação ${r.id}`,
                                });
                              }}
                              className="text-left font-mono underline decoration-slate-300 hover:decoration-blue-600 cursor-pointer disabled:no-underline"
                            >
                              {r.id}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{r.requester}</td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {r.system} · {r.role}
                          </td>
                          <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                            {r.approved ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Aprovado
                              </span>
                            ) : (
                              <span className="text-slate-500">Pendente</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Action Form for Selected Row */}
              <div className="pt-2 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">
                    Item em foco:{' '}
                    <strong className="font-mono text-slate-900">{activeSandboxRow?.id}</strong> ·{' '}
                    {activeSandboxRow?.requester}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policyChecked}
                      data-testid="policy-compliance-checkbox"
                      onChange={(e) => {
                        setPolicyChecked(e.target.checked);
                        if (e.target.checked) {
                          recordStepIfActive({
                            label: 'Marcar aceite de conformidade LGPD / Governança',
                            action: 'check',
                            tagName: 'input',
                            dataTestId: 'policy-compliance-checkbox',
                            ariaLabel: 'Confirmo revisão de alçada e conformidade',
                          });
                        }
                      }}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>Confirmo revisão de alçada e conformidade LGPD</span>
                  </label>

                  <div>
                    <label
                      htmlFor="sandbox-grant-duration"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Vigência da concessão
                    </label>
                    <select
                      id="sandbox-grant-duration"
                      value={grantDuration}
                      data-testid="grant-duration-select"
                      onChange={(e) => {
                        setGrantDuration(e.target.value);
                        recordStepIfActive({
                          label: `Selecionar vigência de concessão (${e.target.value})`,
                          action: 'select',
                          tagName: 'select',
                          dataTestId: 'grant-duration-select',
                          ariaLabel: 'Vigência da concessão',
                          value: e.target.value,
                        });
                      }}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                    >
                      <option value="30d">30 dias (Temporário)</option>
                      <option value="90d">90 dias (Padrão Trimestral)</option>
                      <option value="180d">180 dias (Semestral)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    data-action="approve-access"
                    onClick={() => {
                      recordStepIfActive({
                        label: 'Acionar botão primário Aprovar Concessão',
                        action: 'click',
                        tagName: 'button',
                        dataAction: 'approve-access',
                        ariaLabel: 'Aprovar Concessão',
                      });
                      setConfirmModalOpen(true);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Aprovar Concessão
                  </button>
                </div>

                {confirmModalOpen && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs space-y-0.5">
                      <p className="font-semibold text-slate-900">
                        Confirmar assinatura eletrônica para {activeSandboxRow?.id}?
                      </p>
                      <p className="text-slate-600">
                        Vigência {grantDuration} · Registrado sob seu token OAuth corporativo.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmModalOpen(false)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        data-action="confirm-modal-submit"
                        onClick={() => {
                          recordStepIfActive({
                            label: 'Confirmar efetivação no diálogo de auditoria',
                            action: 'click',
                            tagName: 'button',
                            dataAction: 'confirm-modal-submit',
                            ariaLabel: 'Confirmar e Assinar',
                          });
                          setConfirmModalOpen(false);
                          setPolicyChecked(false);
                          setSandboxRows((prev) => {
                            const updated = prev.map((r) =>
                              r.id === selectedRowId ? { ...r, approved: true } : r
                            );
                            const nextPending = updated.find((r) => !r.approved);
                            if (nextPending) setSelectedRowId(nextPending.id);
                            return updated;
                          });
                        }}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                      >
                        Confirmar e Assinar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right: Step Modeler & Selector Editor (5 cols) */}
        <section
          aria-label="Sequência modelada de passos"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Sequência de Cliques Modelada ({draftSteps.length})
              </h2>
              <p className="text-xs text-slate-500">
                Sincronizada com Playwright, Selenium e Extensão MV3
              </p>
            </div>
            <button
              type="button"
              onClick={handleApplyToBatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Aplicar Modelo ao Lote</span>
            </button>
          </div>

          {formMessage && (
            <div
              className={`px-5 py-2.5 text-xs font-medium border-b ${
                formMessage.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {formMessage.text}
            </div>
          )}

          <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
            {draftSteps.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-xs font-medium text-slate-800">
                  Aguardando cliques na janela espelho ao lado...
                </p>
                <p className="text-xs text-slate-500">
                  Interaja com a tabela de demonstração ou adicione um seletor manual abaixo.
                </p>
              </div>
            ) : (
              draftSteps.map((step, index) => (
                <div key={step.id} className="p-4 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-900">
                      <span className="font-mono tabular-nums text-slate-400 mr-1.5">
                        {String(step.order).padStart(2, '0')}.
                      </span>
                      {step.label}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMoveStep(index, -1)}
                        disabled={index === 0}
                        aria-label={`Mover passo ${step.order} para cima`}
                        className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStep(index, 1)}
                        disabled={index === draftSteps.length - 1}
                        aria-label={`Mover passo ${step.order} para baixo`}
                        className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteStep(step.id)}
                        aria-label={`Remover passo ${step.order}`}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {step.action} · {step.waitBeforeMs}ms
                    </span>
                    <input
                      type="text"
                      value={step.cssSelector}
                      onChange={(e) => handleSelectorEdit(step.id, e.target.value)}
                      aria-label={`Seletor CSS do passo ${step.order}`}
                      className="flex-1 px-2.5 py-1 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Custom Step Form */}
          <form
            onSubmit={handleAddCustomStep}
            className="p-4 bg-slate-50 border-t border-slate-200 space-y-3"
          >
            <p className="text-xs font-semibold text-slate-700">
              Adicionar Seletor Customizado (Portal Externo)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={newStepLabel}
                onChange={(e) => setNewStepLabel(e.target.value)}
                aria-label="Descrição do novo passo"
                placeholder="Ex.: Clicar em Conceder"
                className="sm:col-span-2 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
              />
              <select
                value={newStepAction}
                onChange={(e) => setNewStepAction(e.target.value as StepActionType)}
                aria-label="Tipo de ação"
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
              >
                <option value="click">click</option>
                <option value="check">check</option>
                <option value="select">select</option>
                <option value="fill">fill</option>
                <option value="wait_visible">wait_visible</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newStepSelector}
                onChange={(e) => setNewStepSelector(e.target.value)}
                aria-label="Seletor CSS ou atributo"
                placeholder='button[data-testid="approve-btn"]'
                className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
              />
              {(newStepAction === 'select' || newStepAction === 'fill') && (
                <input
                  type="text"
                  value={newStepValue}
                  onChange={(e) => setNewStepValue(e.target.value)}
                  aria-label="Valor de preenchimento"
                  placeholder="Valor"
                  className="w-24 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                />
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Incluir</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
