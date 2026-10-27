import React from 'react';
import { ExternalLink, Globe, Info, Puzzle, Terminal } from 'lucide-react';

/**
 * O painel "Navegador Interno Real" controla um Chromium via Playwright, o que
 * exige um processo de servidor com filesystem persistente. Em hospedagem
 * estática (Vercel) isso não existe, então o painel explica a limitação e
 * oferece o caminho que funciona: portal de demonstração + extensão.
 */
export function BrowserServerRequired({ targetPortalUrl }: { targetPortalUrl: string }) {
  const demoHref = '/iam-portal.html';
  const externalHref = /^https?:\/\//i.test(targetPortalUrl || '') ? targetPortalUrl : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[900px] w-full mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-amber-600" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">
              Navegador Chromium real exige o servidor local
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Esta tela abre um Chromium controlado por Playwright, com perfil persistente em
              disco e captura de tela contínua. Hospedagem estática não oferece nem processo
              contínuo nem disco — por isso ela fica indisponível no site publicado.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href={demoHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <Globe className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <span>
              <strong className="block text-sm text-slate-900">Abrir portal de demonstração</strong>
              <span className="text-xs text-slate-600">
                Página de teste inclusa no próprio site, com tabela de aprovações, modal e
                dropdowns — boa para exercitar o robô.
              </span>
            </span>
          </a>

          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <span>
                <strong className="block text-sm text-slate-900">Abrir portal configurado</strong>
                <span className="text-xs text-slate-600 break-all">{targetPortalUrl}</span>
              </span>
            </a>
          ) : (
            <a
              href="#extension"
              className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <Puzzle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <span>
                <strong className="block text-sm text-slate-900">Usar a extensão</strong>
                <span className="text-xs text-slate-600">
                  Abra a aba Extensão, baixe o .zip e instale no Chrome ou Edge.
                </span>
              </span>
            </a>
          )}
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-900 leading-relaxed space-y-1">
            <p>
              <strong>O que continua funcionando neste site:</strong> fila de 418 solicitações,
              execução simulada com logs e métricas, edição de passos, proxies, exportação CSV,
              pacote Python e geração da extensão (.zip).
            </p>
            <p>
              <strong>O que precisa do servidor:</strong> apenas o Chromium interno com captura de
              tela e clique por coordenadas.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <strong className="text-xs uppercase tracking-wide text-emerald-300">
              Para usar o navegador interno
            </strong>
          </div>
          <pre className="text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre-wrap">
{`git clone https://github.com/xploryngDAO/AutoClicker-v2
cd AutoClicker-v2
npm install
npm run dev     # http://localhost:3000`}
          </pre>
          <p className="mt-2 text-[11px] text-slate-400">
            No servidor local o Chromium sobe com o perfil persistente e a captura de tela volta a
            funcionar.
          </p>
        </div>
      </div>
    </div>
  );
}
