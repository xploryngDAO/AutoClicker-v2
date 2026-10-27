import React, { useState } from 'react';
import { Code2, ShieldCheck, Sliders } from 'lucide-react';
import type { AutomationConfig, ProxyEndpoint, WorkflowStep } from '../types/automation';
import { PythonScriptsView } from './PythonScriptsView';
import { ResilienceProxiesView } from './ResilienceProxiesView';

interface AdvancedSettingsViewProps {
  config: AutomationConfig;
  steps: WorkflowStep[];
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

export function AdvancedSettingsView({
  config,
  steps,
  proxies,
  onSaveConfig,
  onAddProxy,
  onToggleProxy,
  onCheckProxy,
  onDeleteProxy,
  onTriggerChallenge,
}: AdvancedSettingsViewProps) {
  const [subTab, setSubTab] = useState<'python' | 'proxies'>('python');

  return (
    <div className="space-y-6">
      {/* Friendly Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-4">
        <button
          type="button"
          onClick={() => setSubTab('python')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer ${
            subTab === 'python'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
          }`}
        >
          <Code2 className="w-4 h-4 text-blue-400" />
          <span>Scripts de Automação Python (Playwright & Selenium)</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('proxies')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer ${
            subTab === 'proxies'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Configurações de Rede, Proxies e Anti-Bloqueio</span>
        </button>
      </div>

      {subTab === 'python' ? (
        <PythonScriptsView config={config} steps={steps} proxies={proxies} />
      ) : (
        <ResilienceProxiesView
          config={config}
          proxies={proxies}
          onSaveConfig={onSaveConfig}
          onAddProxy={onAddProxy}
          onToggleProxy={onToggleProxy}
          onCheckProxy={onCheckProxy}
          onDeleteProxy={onDeleteProxy}
          onTriggerChallenge={onTriggerChallenge}
        />
      )}
    </div>
  );
}
