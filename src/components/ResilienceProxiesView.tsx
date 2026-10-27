import React, { useState } from 'react';
import { Activity, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import type {
  AuthPersistenceMode,
  AutomationConfig,
  ChallengeResolutionMode,
  ProxyEndpoint,
} from '../types/automation';

interface ResilienceProxiesViewProps {
  config: AutomationConfig;
  proxies: ProxyEndpoint[];
  onSaveConfig: (patch: Partial<AutomationConfig>) => Promise<{ ok: boolean; error?: string }>;
  onAddProxy: (payload: {
    label: string;
    protocol: 'HTTP' | 'HTTPS' | 'SOCKS5';
    host: string;
    port: number;
    region: string;
    stickySession: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  onToggleProxy: (id: string, enabled: boolean) => Promise<void>;
  onCheckProxy: (id: string) => Promise<void>;
  onDeleteProxy: (id: string) => Promise<void>;
  onTriggerChallenge: () => void;
}

export function ResilienceProxiesView({
  config,
  proxies,
  onSaveConfig,
  onAddProxy,
  onToggleProxy,
  onCheckProxy,
  onDeleteProxy,
  onTriggerChallenge,
}: ResilienceProxiesViewProps) {
  const [formState, setFormState] = useState<AutomationConfig>(config);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const [proxyLabel, setProxyLabel] = useState('');
  const [proxyProtocol, setProxyProtocol] = useState<'HTTP' | 'HTTPS' | 'SOCKS5'>('HTTPS');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('8443');
  const [proxyRegion, setProxyRegion] = useState('São Paulo · BR');
  const [proxySticky, setProxySticky] = useState(true);
  const [proxyError, setProxyError] = useState<string | null>(null);

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveFeedback(null);
    if (!formState.targetPortalUrl.trim()) {
      setSaveFeedback({ type: 'err', text: 'A URL da plataforma alvo não pode ficar vazia.' });
      return;
    }
    const res = await onSaveConfig(formState);
    if (res.ok) {
      setSaveFeedback({
        type: 'ok',
        text: 'Configurações de sessão OAuth, cadência e tratamento de desafios salvas com sucesso.',
      });
    } else {
      setSaveFeedback({ type: 'err', text: res.error || 'Erro ao salvar configurações.' });
    }
  };

  const handleProxySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProxyError(null);
    const parsedPort = Number(proxyPort);
    if (!proxyLabel.trim() || !proxyHost.trim() || !parsedPort || parsedPort < 1 || parsedPort > 65535) {
      setProxyError('Preencha nome identificador, host/IP válido e porta entre 1 e 65535.');
      return;
    }
    const res = await onAddProxy({
      label: proxyLabel.trim(),
      protocol: proxyProtocol,
      host: proxyHost.trim(),
      port: parsedPort,
      region: proxyRegion.trim() || 'Corporativo · BR',
      stickySession: proxySticky,
    });
    if (!res.ok) {
      setProxyError(res.error || 'Falha ao cadastrar endpoint.');
      return;
    }
    setProxyLabel('');
    setProxyHost('');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sessão OAuth Microsoft, Resiliência & Pool de Proxies
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Configure como os motores Python e a Extensão reutilizam sua autenticação MFA legítima, gerenciam cadência humana contra bloqueios WAF e distribuem tráfego por gateways corporativos.
          </p>
        </div>

        <button
          type="button"
          onClick={onTriggerChallenge}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <span>Disparar Teste de Desafio</span>
        </button>
      </div>

      {/* Form Section: OAuth + Anti-Bot + Cadence */}
      <form
        onSubmit={handleConfigSubmit}
        className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200"
      >
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              01. Persistência de Sessão Microsoft OAuth / Authenticator
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mantém cookies Entra ID e tokens MSAL ativos para não exigir nova aprovação MFA a cada solicitação.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="cfg-target-url"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                URL da Plataforma de Aprovações
              </label>
              <input
                id="cfg-target-url"
                type="url"
                value={formState.targetPortalUrl}
                onChange={(e) => setFormState({ ...formState, targetPortalUrl: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-auth-mode"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Modo de Autenticação do Navegador
              </label>
              <select
                id="cfg-auth-mode"
                value={formState.authMode}
                onChange={(e) =>
                  setFormState({ ...formState, authMode: e.target.value as AuthPersistenceMode })
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="persistent_profile">
                  Perfil Persistente Chromium (launch_persistent_context)
                </option>
                <option value="cdp_attach">
                  Anexar via Chrome DevTools Protocol (Porta 9222)
                </option>
                <option value="extension_session">
                  Sessão Nativa via Extensão MV3 em Segundo Plano
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="cfg-ms-hint"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Conta Microsoft (Login Hint)
              </label>
              <input
                id="cfg-ms-hint"
                type="email"
                value={formState.microsoftTenantHint}
                onChange={(e) =>
                  setFormState({ ...formState, microsoftTenantHint: e.target.value })
                }
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="cfg-profile-dir"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Diretório Local do Perfil OAuth
              </label>
              <input
                id="cfg-profile-dir"
                type="text"
                value={formState.profileDirPath}
                onChange={(e) => setFormState({ ...formState, profileDirPath: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-row-sel"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Seletor CSS de Linha Pendente
              </label>
              <input
                id="cfg-row-sel"
                type="text"
                value={formState.rowContainerSelector}
                onChange={(e) =>
                  setFormState({ ...formState, rowContainerSelector: e.target.value })
                }
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-cdp-url"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Endpoint CDP (quando modo Anexar)
              </label>
              <input
                id="cfg-cdp-url"
                type="text"
                value={formState.cdpEndpointUrl}
                onChange={(e) => setFormState({ ...formState, cdpEndpointUrl: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              02. Tratamento de CAPTCHA, Cadência Humana & Retentativas
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Previne bloqueios por rate-limit (HTTP 429) e define como agir diante de desafios interativos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="cfg-challenge-mode"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Estratégia de Resolução de CAPTCHA / Renovação MFA
              </label>
              <select
                id="cfg-challenge-mode"
                value={formState.challengeMode}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    challengeMode: e.target.value as ChallengeResolutionMode,
                  })
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="human_handoff">
                  Handoff Assistido (Pausa fila + Alerta imediato ao operador)
                </option>
                <option value="external_solver_webhook">
                  Integração via Webhook / Serviço de Token Autorizado
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="cfg-solver-url"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Endpoint Webhook de Token (Opcional)
              </label>
              <input
                id="cfg-solver-url"
                type="text"
                value={formState.solverWebhookUrl}
                onChange={(e) => setFormState({ ...formState, solverWebhookUrl: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="cfg-base-delay"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Delay Base (ms)
              </label>
              <input
                id="cfg-base-delay"
                type="number"
                min={100}
                max={5000}
                value={formState.baseDelayMs}
                onChange={(e) =>
                  setFormState({ ...formState, baseDelayMs: Number(e.target.value) || 300 })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-jitter"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Jitter Aleatório (ms)
              </label>
              <input
                id="cfg-jitter"
                type="number"
                min={0}
                max={3000}
                value={formState.randomJitterMs}
                onChange={(e) =>
                  setFormState({ ...formState, randomJitterMs: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-retries"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Máx. Tentativas por Item
              </label>
              <input
                id="cfg-retries"
                type="number"
                min={1}
                max={10}
                value={formState.maxRetries}
                onChange={(e) =>
                  setFormState({ ...formState, maxRetries: Number(e.target.value) || 3 })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="cfg-backoff"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Multiplicador Backoff
              </label>
              <input
                id="cfg-backoff"
                type="number"
                min={1}
                max={5}
                value={formState.backoffMultiplier}
                onChange={(e) =>
                  setFormState({ ...formState, backoffMultiplier: Number(e.target.value) || 2 })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <label className="flex items-center gap-2.5 text-xs text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={formState.stickyProxyPerOAuthToken}
                onChange={(e) =>
                  setFormState({ ...formState, stickyProxyPerOAuthToken: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>
                Manter IP Sticky durante vigência do token OAuth Microsoft (evita revogação por Conditional Access)
              </span>
            </label>

            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salvar Parâmetros</span>
            </button>
          </div>

          {saveFeedback && (
            <p
              className={`text-xs font-medium ${
                saveFeedback.type === 'ok' ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {saveFeedback.text}
            </p>
          )}
        </div>
      </form>

      {/* Section 03: Smart Proxy Pool Table + Add Proxy */}
      <section
        aria-label="Gerenciamento inteligente de proxies"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">
            03. Pool Inteligente de Gateways & Proxies ({proxies.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Failover automático em caso de timeout de rede ou limitação de taxa HTTP 429.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold">
                <th className="py-2.5 px-6">Identificador</th>
                <th className="py-2.5 px-3">Endpoint</th>
                <th className="py-2.5 px-3">Região</th>
                <th className="py-2.5 px-3 text-right">Latência</th>
                <th className="py-2.5 px-3 text-right">Atendidos</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {proxies.map((px) => (
                <tr key={px.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-6 font-medium text-slate-900">
                    {px.label}
                    {px.stickySession ? (
                      <span className="text-slate-400 font-normal"> · Sticky</span>
                    ) : null}
                  </td>
                  <td className="py-3 px-3 font-mono tabular-nums text-slate-700">
                    {px.protocol.toLowerCase()}://{px.host}:{px.port}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{px.region}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {px.latencyMs}ms · {px.successRate}%
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {px.requestsServed}
                  </td>
                  <td className="py-3 px-3">
                    <button
                      type="button"
                      onClick={() => onToggleProxy(px.id, !px.enabled)}
                      className={`text-xs font-semibold underline cursor-pointer ${
                        px.enabled ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {px.enabled ? 'Ativo' : 'Desativado'}
                    </button>
                  </td>
                  <td className="py-3 px-6 text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => onCheckProxy(px.id)}
                      aria-label={`Testar latência de ${px.label}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>Testar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProxy(px.id)}
                      aria-label={`Remover proxy ${px.label}`}
                      className="inline-flex items-center p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={handleProxySubmit}
          className="p-6 bg-slate-50 border-t border-slate-200 space-y-3"
        >
          <p className="text-xs font-semibold text-slate-700">Cadastrar Novo Proxy no Pool</p>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
            <input
              type="text"
              value={proxyLabel}
              onChange={(e) => setProxyLabel(e.target.value)}
              aria-label="Nome do proxy"
              placeholder="Ex.: Gateway Campinas-03"
              className="sm:col-span-2 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            />
            <select
              value={proxyProtocol}
              onChange={(e) =>
                setProxyProtocol(e.target.value as 'HTTP' | 'HTTPS' | 'SOCKS5')
              }
              aria-label="Protocolo do proxy"
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="HTTPS">HTTPS</option>
              <option value="HTTP">HTTP</option>
              <option value="SOCKS5">SOCKS5</option>
            </select>
            <input
              type="text"
              value={proxyHost}
              onChange={(e) => setProxyHost(e.target.value)}
              aria-label="Host ou IP do proxy"
              placeholder="10.148.30.15"
              className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <input
              type="number"
              value={proxyPort}
              onChange={(e) => setProxyPort(e.target.value)}
              aria-label="Porta do proxy"
              placeholder="8443"
              className="px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar Rota</span>
            </button>
          </div>
          {proxyError && <p className="text-xs font-medium text-red-600">{proxyError}</p>}
        </form>
      </section>
    </div>
  );
}
