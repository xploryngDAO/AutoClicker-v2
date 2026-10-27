import {
  buildChromeExtensionZipEntries,
  buildPythonBundleZipEntries,
  serializeAuditCsv,
} from './codeGenerators.ts';
import { createZipArchive } from './zipBuilder.ts';
import {
  addProxy,
  checkProxy,
  deleteProxy,
  getLocalSnapshot,
  importQueue,
  patchProxy,
  pauseRun,
  resetQueue,
  resolveChallenge,
  resumeRun,
  retryFailed,
  startRun,
  stopRun,
  triggerChallenge,
  updateConfig,
  updateSteps,
} from './localEngine.ts';

/**
 * Ponte de compatibilidade da API.
 *
 * O estúdio foi escrito contra `/api/*`. Quando não existe servidor (build
 * estático na Vercel), esta ponte responde às mesmas rotas com o motor local,
 * sem que nenhum componente precise saber onde está rodando.
 */

let localMode = false;

export function isLocalMode(): boolean {
  return localMode;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function binary(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'attachment',
    },
  });
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  const raw = init?.body;
  if (!raw) return {};

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

function buildZip(entries: Array<{ path: string; content: string | Uint8Array }>): Uint8Array {
  return createZipArchive(entries);
}

function handleLocalRequest(pathname: string, method: string, init?: RequestInit): Response {
  const body = parseBody(init);
  const snapshot = () => getLocalSnapshot();

  // ---------- estado ----------
  if (pathname === '/api/state' && method === 'GET') {
    return json(snapshot());
  }

  // ---------- execução ----------
  if (pathname === '/api/run/start' && method === 'POST') {
    const result = startRun();
    return json(result, result.ok ? 200 : 400);
  }

  if (pathname === '/api/run/pause' && method === 'POST') {
    return json(pauseRun());
  }

  if (pathname === '/api/run/resume' && method === 'POST') {
    return json(resumeRun());
  }

  if (pathname === '/api/run/stop' && method === 'POST') {
    return json(stopRun());
  }

  if (pathname === '/api/run/reset' && method === 'POST') {
    return json(resetQueue(Number(body.count) || 418));
  }

  if (pathname === '/api/run/retry-failed' && method === 'POST') {
    return json(retryFailed());
  }

  if (pathname === '/api/run/trigger-challenge' && method === 'POST') {
    const result = triggerChallenge();
    return json(result, result.ok ? 200 : 400);
  }

  if (pathname === '/api/run/resolve-challenge' && method === 'POST') {
    return json(resolveChallenge());
  }

  // ---------- configuração ----------
  if (pathname === '/api/steps' && method === 'PUT') {
    const result = updateSteps((body.steps || []) as never);
    return json({ ...result, steps: snapshot().steps }, result.ok ? 200 : 400);
  }

  if (pathname === '/api/config' && method === 'PUT') {
    const result = updateConfig(body as never);
    return json({ ...result, config: snapshot().config }, result.ok ? 200 : 400);
  }

  // ---------- proxies ----------
  if (pathname === '/api/proxies' && method === 'POST') {
    const result = addProxy(body as never);
    return json(result, result.ok ? 200 : 400);
  }

  const proxyMatch = pathname.match(/^\/api\/proxies\/([^/]+)(\/check)?$/);
  if (proxyMatch) {
    const proxyId = decodeURIComponent(proxyMatch[1]);

    if (proxyMatch[2] && method === 'POST') {
      return json(checkProxy(proxyId));
    }
    if (method === 'PATCH') {
      return json(patchProxy(proxyId, body as never));
    }
    if (method === 'DELETE') {
      return json(deleteProxy(proxyId));
    }
  }

  // ---------- fila ----------
  if (pathname === '/api/queue/import' && method === 'POST') {
    const result = importQueue(String(body.csvText || ''));
    return json(result, result.ok ? 200 : 400);
  }

  // ---------- exportações ----------
  if (pathname === '/api/export/chrome-extension') {
    const current = snapshot();
    return binary(
      buildZip(buildChromeExtensionZipEntries(current.config, current.steps)),
      'application/zip'
    );
  }

  if (pathname === '/api/export/python-bundle') {
    const current = snapshot();
    return binary(
      buildZip(
        buildPythonBundleZipEntries(current.config, current.steps, current.proxies, current.queue)
      ),
      'application/zip'
    );
  }

  if (pathname === '/api/export/audit-csv') {
    const current = snapshot();
    return binary(
      new TextEncoder().encode(serializeAuditCsv(current.queue)),
      'text/csv; charset=utf-8'
    );
  }

  // ---------- navegador real (indisponível sem servidor) ----------
  if (pathname === '/api/browser/status') {
    return json({
      running: false,
      url: '',
      title: 'Indisponível neste ambiente',
      executablePath: 'Requer servidor local (Playwright + Chromium)',
      hasScreenshot: false,
      actionCount: 0,
      unavailable: true,
    });
  }

  if (pathname === '/api/browser/pages') {
    return json({ tabs: [] });
  }

  if (pathname === '/api/browser/logs') {
    return json({ logs: [] });
  }

  if (pathname.startsWith('/api/browser/')) {
    return json(
      {
        ok: false,
        unavailable: true,
        error:
          'O navegador Chromium real exige o servidor local (Playwright). Use a extensão para gravar direto no seu navegador.',
      },
      503
    );
  }

  return json({ error: `Rota não suportada no modo local: ${pathname}` }, 404);
}

async function serverIsAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const response = await fetch('/api/state', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) return false;

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) return false;

    await response.json();
    return true;
  } catch {
    return false;
  }
}

/**
 * Instala a ponte quando não há servidor. Devolve `true` se o app passou a
 * rodar em modo local.
 */
export async function installLocalApiBridge(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (await serverIsAvailable()) {
    localMode = false;
    return false;
  }

  localMode = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const method = (
      init?.method ||
      (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
    ).toUpperCase();

    let pathname = url;
    try {
      pathname = new URL(url, window.location.origin).pathname;
    } catch {
      pathname = url;
    }

    if (!pathname.startsWith('/api/')) {
      return originalFetch(input as RequestInfo, init);
    }

    try {
      return handleLocalRequest(pathname, method, init);
    } catch (error) {
      return json({ ok: false, error: String(error) }, 500);
    }
  };

  return true;
}
