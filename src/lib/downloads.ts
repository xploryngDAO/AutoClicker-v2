export type ExportKind = 'chrome-extension' | 'python-bundle' | 'audit-csv';

const EXPORTS: Record<ExportKind, { path: string; filename: string }> = {
  'chrome-extension': {
    path: '/api/export/chrome-extension',
    filename: 'autoapprove-extensao-chrome-mv3.zip',
  },
  'python-bundle': {
    path: '/api/export/python-bundle',
    filename: 'autoapprove-python-playwright-selenium.zip',
  },
  'audit-csv': {
    path: '/api/export/audit-csv',
    filename: 'auditoria_aprovacoes.csv',
  },
};

/**
 * Baixa um artefato gerado pelo estúdio.
 *
 * Usa `fetch` (e não um `<a href>`) porque a rota `/api/*` é respondida pela
 * ponte local quando não existe servidor — assim o mesmo botão funciona no
 * deploy estático e no `npm run dev`.
 */
export async function downloadExport(kind: ExportKind): Promise<void> {
  const target = EXPORTS[kind];

  const response = await fetch(target.path);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) detail = payload.error;
    } catch {
      // resposta sem JSON: mantém o status
    }
    throw new Error(`Não foi possível gerar ${target.filename}: ${detail}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = target.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
