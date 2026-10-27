import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { AutomationConfig, ProxyEndpoint, WorkflowStep } from '../types/automation';
import {
  generatePlaywrightScript,
  generatePythonConfigJson,
  generatePythonReadme,
  generatePythonRequirements,
  generateSeleniumScript,
} from '../lib/codeGenerators';

interface PythonScriptsViewProps {
  config: AutomationConfig;
  steps: WorkflowStep[];
  proxies: ProxyEndpoint[];
}

type PythonFileTab =
  | 'approver_playwright.py'
  | 'approver_selenium.py'
  | 'config.json'
  | 'requirements.txt'
  | 'README.md';

export function PythonScriptsView({ config, steps, proxies }: PythonScriptsViewProps) {
  const [selectedFile, setSelectedFile] = useState<PythonFileTab>('approver_playwright.py');
  const [copied, setCopied] = useState(false);

  const filesMap = useMemo<Record<PythonFileTab, string>>(
    () => ({
      'approver_playwright.py': generatePlaywrightScript(config, steps, proxies),
      'approver_selenium.py': generateSeleniumScript(config, steps, proxies),
      'config.json': generatePythonConfigJson(config, steps, proxies),
      'requirements.txt': generatePythonRequirements(),
      'README.md': generatePythonReadme(config),
    }),
    [config, steps, proxies]
  );

  const currentContent = filesMap[selectedFile];
  const activeProxiesCount = proxies.filter((p) => p.enabled).length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored safely
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Scripts Python — Playwright & Selenium 4
          </h2>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Código-fonte Python gerado automaticamente para automação direta via terminal ou servidor corporativo, com persistência OAuth Microsoft, rotação de proxies e relatórios CSV.
          </p>
        </div>

        <a
          href="/api/export/python-bundle"
          download="autoapprove-python-playwright-selenium.zip"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Baixar Pacote Python (.zip)</span>
        </a>
      </div>

      {/* Summary Parameter Strip */}
      <section
        aria-label="Parâmetros sincronizados no pacote Python"
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-xs"
      >
        <div className="p-4">
          <span className="text-slate-500 block">Motores Inclusos</span>
          <strong className="mt-1 block text-slate-900 font-semibold">
            Playwright Async + Selenium 4
          </strong>
        </div>
        <div className="p-4">
          <span className="text-slate-500 block">Sessão Microsoft OAuth</span>
          <strong className="mt-1 block text-slate-900 font-mono truncate">
            {config.authMode === 'cdp_attach' ? config.cdpEndpointUrl : config.profileDirPath}
          </strong>
        </div>
        <div className="p-4">
          <span className="text-slate-500 block">Passos Sincronizados</span>
          <strong className="mt-1 block text-slate-900 font-mono tabular-nums">
            {steps.length} ações por concessão · até {config.maxRetries}x retry
          </strong>
        </div>
        <div className="p-4">
          <span className="text-slate-500 block">Pool de Proxies no Script</span>
          <strong className="mt-1 block text-slate-900 font-mono tabular-nums">
            {activeProxiesCount} gateways ativos · delay {config.baseDelayMs}ms
          </strong>
        </div>
      </section>

      {/* Code Viewer Container */}
      <section
        aria-label="Inspeção de arquivos Python"
        className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Arquivos do pacote Python"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-800 rounded-lg"
          >
            {(
              [
                'approver_playwright.py',
                'approver_selenium.py',
                'config.json',
                'requirements.txt',
                'README.md',
              ] as const
            ).map((fname) => (
              <button
                key={fname}
                role="tab"
                aria-selected={selectedFile === fname}
                type="button"
                onClick={() => setSelectedFile(fname)}
                className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedFile === fname
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {fname}
              </button>
            ))}
          </div>

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
                <span>Copiar {selectedFile}</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-5 overflow-x-auto max-h-[500px] text-xs font-mono leading-relaxed text-slate-100">
          <code>{currentContent}</code>
        </pre>
      </section>
    </div>
  );
}
