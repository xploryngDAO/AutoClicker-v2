import type {
  AccessRequestItem,
  AutomationConfig,
  ProxyEndpoint,
  WorkflowStep,
} from '../types/automation.ts';
import { getDefaultTasks } from './seedData.ts';
import {
  generateBackgroundJs,
  generateContentJs,
  generateExtensionManifest,
  generatePopupHtml,
  generatePopupJs,
  generateSidepanelCss,
  generateSidepanelHtml,
  generateSidepanelJs,
} from './extensionTemplates.ts';
import { createExtensionIconPng, type ZipFileEntry } from './zipBuilder.ts';

function escapePyString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePySingleQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function generatePlaywrightScript(
  config: AutomationConfig,
  steps: WorkflowStep[],
  proxies: ProxyEndpoint[]
): string {
  const activeProxies = proxies.filter((p) => p.enabled);
  const proxyListJson = JSON.stringify(
    activeProxies.map((p) => ({
      label: p.label,
      server: `${p.protocol.toLowerCase()}://${p.host}:${p.port}`,
      sticky: p.stickySession,
    })),
    null,
    4
  );

  const stepsBlock = steps
    .map((s) => {
      const sel = escapePySingleQuote(s.cssSelector);
      const label = escapePyString(s.label);
      const val = escapePyString(s.value || '');
      let actionCode = `await page.locator('${sel}').first.click(timeout=${s.timeoutMs})`;
      if (s.action === 'check') {
        actionCode = `await page.locator('${sel}').first.check(timeout=${s.timeoutMs})`;
      } else if (s.action === 'select') {
        actionCode = `await page.locator('${sel}').first.select_option("${val}", timeout=${s.timeoutMs})`;
      } else if (s.action === 'fill') {
        actionCode = `await page.locator('${sel}').first.fill("${val}", timeout=${s.timeoutMs})`;
      } else if (s.action === 'wait_visible') {
        actionCode = `await page.locator('${sel}').first.wait_for(state="visible", timeout=${s.timeoutMs})`;
      }

      return `        # Passo ${s.order}: ${label}
        await human_pause(${s.waitBeforeMs}, ${config.randomJitterMs})
        logger.info(f"[{req_id}] Executando Passo ${s.order}: ${label}")
        ${actionCode}`;
    })
    .join('\n\n');

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AutoApprove RPA — Executor Assíncrono Playwright (Sessão Microsoft OAuth + Auditoria)
Gerado dinamicamente com ${steps.length} passos modelados para aprovação em lote.
"""

import asyncio
import csv
import json
import logging
import os
import random
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

TARGET_URL = "${escapePyString(config.targetPortalUrl)}"
ROW_SELECTOR = "${escapePyString(config.rowContainerSelector)}"
NEXT_PAGE_SELECTOR = "${escapePyString(config.nextPageSelector)}"
AUTH_MODE = "${config.authMode}"
USER_DATA_DIR = "${escapePyString(config.profileDirPath)}"
CDP_ENDPOINT = "${escapePyString(config.cdpEndpointUrl)}"
MICROSOFT_HINT = "${escapePyString(config.microsoftTenantHint)}"

CHALLENGE_MODE = "${config.challengeMode}"
SOLVER_WEBHOOK_URL = "${escapePyString(config.solverWebhookUrl)}"
SOLVER_TIMEOUT_SEC = ${config.solverTimeoutSec}

BASE_DELAY_MS = ${config.baseDelayMs}
JITTER_MS = ${config.randomJitterMs}
MAX_RETRIES = ${config.maxRetries}
BACKOFF_MULTIPLIER = ${config.backoffMultiplier}
HEADLESS_AFTER_AUTH = ${config.headlessAfterLogin ? 'True' : 'False'}

PROXY_POOL = ${proxyListJson}

Path("logs").mkdir(exist_ok=True)
Path("traces").mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    handlers=[
        logging.FileHandler("logs/execucao_rpa.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("autoapprove")


async def human_pause(base_ms: int, jitter_ms: int) -> None:
    delay_sec = (base_ms + random.uniform(0, max(10, jitter_ms))) / 1000.0
    await asyncio.sleep(delay_sec)


class ProxyPoolManager:
    """Gerencia afinidade de proxy com token OAuth Microsoft e failover em HTTP 429."""

    def __init__(self, pool: list[dict]):
        self.pool = pool
        self.index = 0

    def current(self) -> dict | None:
        if not self.pool:
            return None
        return self.pool[self.index % len(self.pool)]

    def rotate_on_throttle(self) -> dict | None:
        if len(self.pool) <= 1:
            return self.current()
        self.index = (self.index + 1) % len(self.pool)
        selected = self.pool[self.index]
        logger.warning(f"Rotacionando rota de rede para: {selected['label']} ({selected['server']})")
        return selected


async def ensure_microsoft_oauth_session(page) -> None:
    """Detecta tela de login Microsoft Entra ID / Authenticator e aguarda sessão válida."""
    await page.goto(TARGET_URL, wait_until="domcontentloaded")
    current_url = page.url.lower()
    needs_login = (
        "login.microsoftonline.com" in current_url
        or "oauth2" in current_url
        or await page.locator('input[type="email"], #idSIButton9').count() > 0
    )

    if needs_login:
        logger.warning(
            "Autenticação Microsoft OAuth / Authenticator requerida. "
            "Conclua o MFA no navegador aberto — a sessão ficará salva no perfil persistente."
        )
        email_input = page.locator('input[type="email"]')
        if await email_input.count() > 0 and MICROSOFT_HINT:
            await email_input.fill(MICROSOFT_HINT)
        await page.wait_for_url(
            lambda url: "login.microsoftonline.com" not in url.lower(),
            timeout=300_000,
        )
        logger.info("Sessão OAuth Microsoft validada e persistida com sucesso.")


async def detect_and_resolve_challenge(page, req_id: str) -> None:
    """Detecta desafios CAPTCHA/Turnstile ou renovação MFA e aplica estratégia configurada."""
    challenge_loc = page.locator(
        'iframe[src*="challenges"], iframe[src*="recaptcha"], [data-challenge-prompt="true"]'
    )
    if await challenge_loc.count() == 0:
        return

    logger.warning(f"[{req_id}] Barreira de verificação detectada na página.")
    if CHALLENGE_MODE == "external_solver_webhook" and SOLVER_WEBHOOK_URL:
        payload = json.dumps({
            "request_id": req_id,
            "page_url": page.url,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")
        req = urllib.request.Request(
            SOLVER_WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=SOLVER_TIMEOUT_SEC) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                token = result.get("token", "")
                if token:
                    await page.evaluate(
                        "(tok) => { window.__rpaChallengeToken = tok; }", token
                    )
                    logger.info(f"[{req_id}] Token de verificação recebido via webhook.")
                    return
        except Exception as exc:
            logger.error(f"[{req_id}] Falha no webhook de desafio ({exc}); acionando handoff assistido.")

    print("\\a", end="", flush=True)
    logger.warning(f"[{req_id}] Aguardando resolução assistida na janela do navegador...")
    await challenge_loc.first.wait_for(state="detached", timeout=180_000)
    logger.info(f"[{req_id}] Desafio superado; retomando fila de aprovações.")


async def approve_single_item(page, index: int) -> tuple[str, str, int, int, str]:
    """Executa a sequência modelada na 1ª rodada com retentativa exponencial e captura de falha."""
    req_id = f"ITEM-{index:04d}"
    row = page.locator(ROW_SELECTOR).first
    if await row.count() > 0:
        attr_id = await row.get_attribute("data-request-id")
        if attr_id:
            req_id = attr_id

    started = time.perf_counter()
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            await detect_and_resolve_challenge(page, req_id)

${stepsBlock}

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            logger.info(f"[{req_id}] Aprovado com sucesso em {elapsed_ms}ms (tentativa {attempt}).")
            return req_id, "approved", attempt, elapsed_ms, ""

        except PlaywrightTimeoutError as exc:
            backoff = (BASE_DELAY_MS / 1000.0) * (BACKOFF_MULTIPLIER ** (attempt - 1))
            shot_path = f"traces/falha_{req_id}_tentativa_{attempt}.png"
            await page.screenshot(path=shot_path, full_page=True)
            logger.warning(
                f"[{req_id}] Timeout no seletor (tentativa {attempt}/{MAX_RETRIES}). "
                f"Evidência salva em {shot_path}. Aguardando {backoff:.1f}s..."
            )
            if attempt == MAX_RETRIES:
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                return req_id, "failed", attempt, elapsed_ms, str(exc)
            await asyncio.sleep(backoff)
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            logger.error(f"[{req_id}] Exceção não recuperável: {exc}")
            return req_id, "failed", attempt, elapsed_ms, str(exc)

    return req_id, "failed", MAX_RETRIES, 0, "Limite de tentativas excedido"


async def main() -> None:
    proxy_mgr = ProxyPoolManager(PROXY_POOL)
    selected_proxy = proxy_mgr.current()
    audit_file = open("logs/auditoria_aprovacoes.csv", "w", newline="", encoding="utf-8")
    writer = csv.writer(audit_file)
    writer.writerow(["timestamp_utc", "request_id", "status", "attempts", "duration_ms", "proxy", "error"])

    async with async_playwright() as p:
        if AUTH_MODE == "cdp_attach":
            logger.info(f"Conectando ao navegador autenticado via CDP: {CDP_ENDPOINT}")
            browser = await p.chromium.connect_over_cdp(CDP_ENDPOINT)
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
        else:
            proxy_cfg = {"server": selected_proxy["server"]} if selected_proxy else None
            context = await p.chromium.launch_persistent_context(
                user_data_dir=USER_DATA_DIR,
                headless=False,
                proxy=proxy_cfg,
                viewport={"width": 1440, "height": 900},
                args=["--disable-blink-features=AutomationControlled"],
            )

        page = context.pages[0] if context.pages else await context.new_page()
        await ensure_microsoft_oauth_session(page)

        processed = 0
        approved_count = 0
        failed_count = 0

        while True:
            pending_count = await page.locator(ROW_SELECTOR).count()
            if pending_count == 0:
                next_btn = page.locator(NEXT_PAGE_SELECTOR)
                if await next_btn.count() > 0 and await next_btn.is_enabled():
                    await next_btn.click()
                    await human_pause(BASE_DELAY_MS, JITTER_MS)
                    continue
                break

            processed += 1
            req_id, status, attempts, duration_ms, err = await approve_single_item(page, processed)
            if status == "approved":
                approved_count += 1
            else:
                failed_count += 1

            writer.writerow([
                datetime.now(timezone.utc).isoformat(),
                req_id,
                status,
                attempts,
                duration_ms,
                selected_proxy["label"] if selected_proxy else "direto",
                err,
            ])
            audit_file.flush()
            await human_pause(BASE_DELAY_MS, JITTER_MS)

        logger.info(
            f"Lote finalizado | Processados: {processed} | Aprovados: {approved_count} | Falhas: {failed_count}"
        )
        audit_file.close()
        if AUTH_MODE != "cdp_attach":
            await context.close()


if __name__ == "__main__":
    asyncio.run(main())
`;
}

export function generateSeleniumScript(
  config: AutomationConfig,
  steps: WorkflowStep[],
  proxies: ProxyEndpoint[]
): string {
  const activeProxy = proxies.find((p) => p.enabled);
  const proxyArg = activeProxy
    ? `${activeProxy.protocol.toLowerCase()}://${activeProxy.host}:${activeProxy.port}`
    : '';

  const seleniumSteps = steps
    .map((s) => {
      const sel = escapePySingleQuote(s.cssSelector);
      const label = escapePyString(s.label);
      const val = escapePyString(s.value || '');
      const timeoutSec = Math.max(2, Math.round(s.timeoutMs / 1000));

      let op = `elem = WebDriverWait(driver, ${timeoutSec}).until(EC.element_to_be_clickable((By.CSS_SELECTOR, '${sel}')))\n            elem.click()`;
      if (s.action === 'check') {
        op = `elem = WebDriverWait(driver, ${timeoutSec}).until(EC.presence_of_element_located((By.CSS_SELECTOR, '${sel}')))\n            if not elem.is_selected():\n                elem.click()`;
      } else if (s.action === 'select') {
        op = `elem = WebDriverWait(driver, ${timeoutSec}).until(EC.presence_of_element_located((By.CSS_SELECTOR, '${sel}')))\n            Select(elem).select_by_value("${val}")`;
      } else if (s.action === 'fill') {
        op = `elem = WebDriverWait(driver, ${timeoutSec}).until(EC.visibility_of_element_located((By.CSS_SELECTOR, '${sel}')))\n            elem.clear()\n            elem.send_keys("${val}")`;
      } else if (s.action === 'wait_visible') {
        op = `WebDriverWait(driver, ${timeoutSec}).until(EC.visibility_of_element_located((By.CSS_SELECTOR, '${sel}')))`;
      }

      return `            # Passo ${s.order}: ${label}
            human_sleep(${s.waitBeforeMs}, ${config.randomJitterMs})
            ${op}`;
    })
    .join('\n\n');

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AutoApprove RPA — Executor Selenium 4 WebDriver (Perfil Persistente OAuth Microsoft)
Alternativa compatível com infraestruturas corporativas padronizadas em WebDriver.
"""

import csv
import logging
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

TARGET_URL = "${escapePyString(config.targetPortalUrl)}"
ROW_SELECTOR = "${escapePyString(config.rowContainerSelector)}"
PROFILE_DIR = os.path.abspath("${escapePyString(config.profileDirPath)}")
PROXY_SERVER = "${escapePyString(proxyArg)}"
MAX_RETRIES = ${config.maxRetries}
BASE_DELAY_MS = ${config.baseDelayMs}
JITTER_MS = ${config.randomJitterMs}

Path("logs").mkdir(exist_ok=True)
Path("traces").mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("autoapprove_selenium")


def human_sleep(base_ms: int, jitter_ms: int) -> None:
    time.sleep((base_ms + random.uniform(0, max(10, jitter_ms))) / 1000.0)


def build_driver() -> webdriver.Chrome:
    opts = Options()
    if "${config.authMode}" == "cdp_attach":
        debugger_host = "${escapePyString(config.cdpEndpointUrl)}".replace("http://", "").replace("https://", "")
        opts.add_experimental_option("debuggerAddress", debugger_host)
    else:
        opts.add_argument(f"--user-data-dir={PROFILE_DIR}")
        opts.add_argument("--window-size=1440,900")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        if PROXY_SERVER:
            opts.add_argument(f"--proxy-server={PROXY_SERVER}")

    driver = webdriver.Chrome(options=opts)
    return driver


def run_batch() -> None:
    driver = build_driver()
    driver.get(TARGET_URL)

    if "login.microsoftonline.com" in driver.current_url.lower():
        logger.warning("Aguardando aprovação no Microsoft Authenticator pelo operador...")
        WebDriverWait(driver, 300).until(
            lambda d: "login.microsoftonline.com" not in d.current_url.lower()
        )
        logger.info("Sessão autenticada detectada. Iniciando processamento da fila.")

    with open("logs/auditoria_selenium.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp_utc", "index", "status", "attempts", "duration_ms", "error"])
        idx = 0

        while True:
            rows = driver.find_elements(By.CSS_SELECTOR, ROW_SELECTOR)
            if not rows:
                break

            idx += 1
            t0 = time.perf_counter()
            success = False
            last_err = ""

            for attempt in range(1, MAX_RETRIES + 1):
                try:
${seleniumSteps}
                    success = True
                    elapsed = int((time.perf_counter() - t0) * 1000)
                    writer.writerow([datetime.now(timezone.utc).isoformat(), idx, "approved", attempt, elapsed, ""])
                    f.flush()
                    logger.info(f"[Item #{idx:04d}] Aprovado em {elapsed}ms.")
                    break
                except (TimeoutException, WebDriverException) as exc:
                    last_err = str(exc).splitlines()[0] if str(exc) else "WebDriverError"
                    driver.save_screenshot(f"traces/selenium_erro_{idx}_t{attempt}.png")
                    logger.warning(f"[Item #{idx:04d}] Falha na tentativa {attempt}/{MAX_RETRIES}: {last_err}")
                    time.sleep(1.5 * attempt)

            if not success:
                elapsed = int((time.perf_counter() - t0) * 1000)
                writer.writerow([datetime.now(timezone.utc).isoformat(), idx, "failed", MAX_RETRIES, elapsed, last_err])
                f.flush()

            human_sleep(BASE_DELAY_MS, JITTER_MS)

    logger.info("Execução Selenium encerrada com rastreabilidade salva em logs/auditoria_selenium.csv.")


if __name__ == "__main__":
    run_batch()
`;
}

export function generatePythonRequirements(): string {
  return `playwright>=1.49.0
selenium>=4.27.0
`;
}

export function generatePythonConfigJson(
  config: AutomationConfig,
  steps: WorkflowStep[],
  proxies: ProxyEndpoint[]
): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      config,
      steps,
      proxies,
    },
    null,
    2
  );
}

export function generatePythonReadme(config: AutomationConfig): string {
  return `# AutoApprove RPA — Pacote Python (Playwright & Selenium)

## 1. Instalação Rápida

\`\`\`bash
python -m venv .venv
source .venv/bin/activate  # No Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
playwright install chromium
\`\`\`

## 2. Primeira Execução com Microsoft OAuth / Authenticator

1. Execute \`python approver_playwright.py\`.
2. Na primeira execução, o Chromium abrirá em \`${config.targetPortalUrl}\` usando o diretório persistente \`${config.profileDirPath}\`.
3. Aprove o login e o código no **Microsoft Authenticator** normalmente. Os tokens de sessão ficarão armazenados localmente para processar todas as 400+ solicitações sem repetir o MFA.
4. Caso prefira conectar em um Chrome/Edge corporativo já aberto, inicie o navegador com \`--remote-debugging-port=9222\` e altere \`AUTH_MODE = "cdp_attach"\`.

## 3. Rastreabilidade e Logs

- \`logs/execucao_rpa.log\`: Log detalhado passo a passo em tempo real.
- \`logs/auditoria_aprovacoes.csv\`: Planilha auditável com timestamp UTC, ID da solicitação, tentativas, duração em ms e proxy utilizado.
- \`traces/\`: Capturas automáticas de tela em caso de timeout ou mudança inesperada de DOM.
`;
}

export interface GeneratedExtensionTextFile {
  filename: string;
  language: 'json' | 'javascript' | 'html' | 'css';
  description: string;
  content: string;
}

export function generateChromeExtensionTextFiles(
  config: AutomationConfig,
  steps: WorkflowStep[]
): GeneratedExtensionTextFile[] {
  const defaultTasks = getDefaultTasks();
  if (steps && steps.length > 0) {
    const iamTask = defaultTasks.find((t) => t.id === "task-iam-approvals");
    if (iamTask) {
      iamTask.steps = steps;
    }
  }

  const defaultWorkflowConfig = {
    targetUrl: config.targetPortalUrl || "http://localhost:3000/iam-portal.html",
    baseDelayMs: config.baseDelayMs || 400,
    randomJitterMs: config.randomJitterMs || 300,
    maxRetries: config.maxRetries || 3,
    activeTaskId: "task-iam-approvals",
  };

  return [
    {
      filename: "manifest.json",
      language: "json",
      description: "Manifest V3 com Side Panel, Alarms, Storage e Content Script",
      content: generateExtensionManifest(),
    },
    {
      filename: "background.js",
      language: "javascript",
      description: "Service Worker Multi-Tarefas com orquestração de rotinas em segundo plano",
      content: generateBackgroundJs(defaultTasks, defaultWorkflowConfig),
    },
    {
      filename: "content.js",
      language: "javascript",
      description: "Motor Universal: Gravação Livre ao Vivo + Assistente de Tabela + Execução Resiliente",
      content: generateContentJs(),
    },
    {
      filename: "sidepanel.html",
      language: "html",
      description: "Interface do Painel Lateral com seletor de tarefas, editor de passos e gravador HUD",
      content: generateSidepanelHtml(),
    },
    {
      filename: "sidepanel.js",
      language: "javascript",
      description: "Controlador do painel lateral, telemetria em tempo real, troca de tarefas e exportador CSV",
      content: generateSidepanelJs(),
    },
    {
      filename: "sidepanel.css",
      language: "css",
      description: "Estilização compacta e moderna do painel lateral",
      content: generateSidepanelCss(),
    },
    {
      filename: "popup.html",
      language: "html",
      description: "Menu pop-up da barra do navegador",
      content: generatePopupHtml(),
    },
    {
      filename: "popup.js",
      language: "javascript",
      description: "Abertura rápida do painel lateral ou início do lote",
      content: generatePopupJs(),
    },
  ];
}

export function buildChromeExtensionZipEntries(
  config: AutomationConfig,
  steps: WorkflowStep[]
): ZipFileEntry[] {
  const textFiles = generateChromeExtensionTextFiles(config, steps);
  const entries: ZipFileEntry[] = textFiles.map((f) => ({
    path: f.filename,
    content: f.content,
  }));

  const icon16 = createExtensionIconPng(16);
  const icon48 = createExtensionIconPng(48);
  const icon128 = createExtensionIconPng(128);

  // Flat icons in root so unpacked extension in Chrome / Edge has zero path or folder resolution issues
  entries.push({ path: 'icon16.png', content: icon16 });
  entries.push({ path: 'icon48.png', content: icon48 });
  entries.push({ path: 'icon128.png', content: icon128 });

  // Explicit directory entry and subfolder icons for Windows Explorer compatibility
  entries.push({ path: 'icons/', content: new Uint8Array(0) });
  entries.push({ path: 'icons/icon16.png', content: icon16 });
  entries.push({ path: 'icons/icon48.png', content: icon48 });
  entries.push({ path: 'icons/icon128.png', content: icon128 });

  entries.push({
    path: 'LEIAME_INSTALACAO.txt',
    content: `AUTOAPPROVE RPA — EXTENSÃO PARA GOOGLE CHROME E MICROSOFT EDGE
========================================================================

COMO INSTALAR NO SEU NAVEGADOR:
1. Descompacte todo o conteúdo deste arquivo ZIP em uma pasta no seu computador
   (ex.: C:\\AutoApproveExtensao ou na sua área de trabalho).
2. Abra o Google Chrome ou Microsoft Edge e acesse a página de extensões:
   - No Chrome: digite chrome://extensions na barra de endereços e aperte Enter
   - No Edge:   digite edge://extensions na barra de endereços e aperte Enter
3. Ative a chave "Modo do desenvolvedor" (Developer mode) no canto superior direito.
4. Clique no botão "Carregar sem compactação" (Load unpacked).
5. Selecione a pasta onde você descompactou os arquivos.
6. Pronto! A extensão AutoApprove estará instalada e pronta.

COMO USAR PARA APROVAR OS 400+ ACESSOS:
1. Abra a página do portal corporativo com sua conta já logada via Microsoft OAuth / Authenticator.
2. Clique no ícone do AutoApprove na barra do navegador (abra o painel lateral).
3. Clique em "Gravar 1ª Rodada na Aba" e aprove manualmente a 1ª solicitação na tela.
4. Clique em "Finalizar Gravação" e em seguida em "Iniciar Aprovações".
5. O robô executará as mais de 400 solicitações na aba em segundo plano!
`,
  });

  return entries;
}

export function buildPythonBundleZipEntries(
  config: AutomationConfig,
  steps: WorkflowStep[],
  proxies: ProxyEndpoint[],
  queue: AccessRequestItem[]
): ZipFileEntry[] {
  return [
    {
      path: 'approver_playwright.py',
      content: generatePlaywrightScript(config, steps, proxies),
    },
    {
      path: 'approver_selenium.py',
      content: generateSeleniumScript(config, steps, proxies),
    },
    {
      path: 'config.json',
      content: generatePythonConfigJson(config, steps, proxies),
    },
    {
      path: 'requirements.txt',
      content: generatePythonRequirements(),
    },
    {
      path: 'README.md',
      content: generatePythonReadme(config),
    },
    {
      path: 'fila_acessos_atual.csv',
      content: serializeAuditCsv(queue),
    },
  ];
}

function escapeCsvCell(val: string | number | undefined): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeAuditCsv(queue: AccessRequestItem[]): string {
  const headers = [
    'id_solicitacao',
    'colaborador',
    'email',
    'departamento',
    'sistema_alvo',
    'perfil_acesso',
    'criticidade',
    'status',
    'tentativas',
    'duracao_ms',
    'proxy_utilizado',
    'hash_rastreio',
    'atualizado_em',
    'mensagem_excecao',
  ];

  const rows = queue.map((item) =>
    [
      item.id,
      item.requesterName,
      item.requesterEmail,
      item.department,
      item.targetSystem,
      item.roleProfile,
      item.riskTier,
      item.status,
      item.attempts,
      item.durationMs,
      item.proxyUsed,
      item.traceHash || '',
      item.updatedAt,
      item.errorMessage || '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
