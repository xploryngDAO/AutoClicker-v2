import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { WorkflowStep } from '../types/automation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANDIDATE_EXECUTABLES = [
  // Linux (imagem de container / CI)
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  // Windows (Chrome/Edge instalados no host)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export interface ElementInspectionResult {
  tagName: string;
  id: string;
  className: string;
  text: string;
  selector: string;
  suggestedTitle: string;
  suggestedDescription: string;
}

export class RealBrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentUrl = 'http://localhost:3000/iam-portal.html';
  private currentTitle = 'Carregando Navegador Real...';
  private executablePath: string | null = null;
  private isInitializing = false;
  private lastScreenshot: Buffer | null = null;
  private lastScreenshotTime = 0;
  private actionLog: Array<{ time: string; action: string; detail: string }> = [];

  constructor() {
    this.findExecutable();
  }

  private findExecutable(): string | null {
    if (this.executablePath) return this.executablePath;
    for (const p of CANDIDATE_EXECUTABLES) {
      if (fs.existsSync(p)) {
        this.executablePath = p;
        return p;
      }
    }
    return null;
  }

  public getStatus() {
    return {
      running: Boolean(this.page),
      url: this.currentUrl,
      title: this.currentTitle,
      executablePath: this.executablePath || 'Não detectado',
      hasScreenshot: Boolean(this.lastScreenshot),
      actionCount: this.actionLog.length,
    };
  }

  public getRecentLogs() {
    return this.actionLog.slice(-50);
  }

  private log(action: string, detail: string) {
    this.actionLog.push({
      time: new Date().toLocaleTimeString('pt-BR'),
      action,
      detail,
    });
    if (this.actionLog.length > 200) {
      this.actionLog.shift();
    }
  }

  public async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (this.isInitializing) {
      // Wait for initialization to complete
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (this.page && !this.page.isClosed()) return this.page;
      }
    }

    this.isInitializing = true;
    try {
      const exec = this.findExecutable();
      if (!exec) {
        throw new Error('Nenhum binário Chromium encontrado no ambiente do servidor.');
      }

      const userDataDir = path.resolve(__dirname, '../../.chromium_rpa_profile');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      this.log('Inicialização', `Lançando Chromium com perfil corporativo em ${userDataDir}`);

      this.context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: exec,
        headless: true,
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--disable-infobars',
          '--window-size=1280,800',
          '--disable-popup-blocking',
          '--lang=pt-BR,pt',
        ],
        ignoreHTTPSErrors: true,
      });

      // Inject comprehensive stealth evasion into every page and frame to bypass Microsoft SSO / Cloudflare detection
      await this.context.addInitScript(() => {
        try {
          // 1. Wipe navigator.webdriver
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
          });

          // 2. Mock window.chrome object
          // @ts-ignore
          window.chrome = {
            app: {
              isInstalled: false,
              InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
              RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            },
            runtime: {
              OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
              OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
              PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
              PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
              PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
              RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
            },
            loadTimes: () => ({
              commitLoadTime: 1.5,
              connectionInfo: 'h2',
              finishDocumentLoadTime: 2.1,
              finishLoadTime: 2.3,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: 1.8,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'h2',
              requestTime: 1.0,
              startLoadTime: 1.0,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
            }),
            csi: () => ({ onloadT: 2.3, pageT: 2.1, startE: 1.0, tran: 15 }),
          };

          // 3. Mock plugins & mimeTypes
          Object.defineProperty(navigator, 'plugins', {
            get: () => [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
            ],
          });

          // 4. Mock languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['pt-BR', 'pt', 'en-US', 'en'],
          });
        } catch {
          // ignore
        }
      });

      // Handle popup windows and multiple tabs (crucial for Microsoft OAuth login popups!)
      this.context.on('page', (newPage) => {
        this.log('Nova Aba Detectada', `Janela/Popup aberto: ${newPage.url()}`);
        this.page = newPage;
        this.setupPageListeners(newPage);
        void this.captureScreenshot();
      });

      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
      this.setupPageListeners(this.page);

      // Navigate to initial portal
      await this.page.goto(this.currentUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      this.currentTitle = (await this.page.title()) || 'Portal IAM';
      this.log('Navegação Inicial', `Página aberta: ${this.currentUrl}`);
      await this.captureScreenshot();

      return this.page;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupPageListeners(page: Page) {
    page.on('load', async () => {
      try {
        if (this.page === page) {
          this.currentUrl = page.url();
          this.currentTitle = (await page.title()) || this.currentTitle;
        }
      } catch {
        // ignore
      }
    });
  }

  public async getOpenTabs(): Promise<Array<{ index: number; title: string; url: string; isActive: boolean }>> {
    if (!this.context) return [];
    const pages = this.context.pages().filter((p) => !p.isClosed());
    const tabs = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = 'Sem Título';
      let url = 'about:blank';
      try {
        title = await p.title();
        url = p.url();
      } catch {
        // ignore
      }
      tabs.push({
        index: i,
        title: title || `Aba ${i + 1}`,
        url,
        isActive: this.page === p,
      });
    }
    return tabs;
  }

  public async switchTab(index: number): Promise<{ ok: boolean; title: string; url: string }> {
    if (!this.context) throw new Error('Chromium não inicializado');
    const pages = this.context.pages().filter((p) => !p.isClosed());
    if (index < 0 || index >= pages.length) {
      throw new Error(`Índice de aba inválido: ${index}`);
    }
    this.page = pages[index];
    this.currentUrl = this.page.url();
    this.currentTitle = await this.page.title();
    await this.captureScreenshot();
    this.log('Trocar Aba', `Alternado para aba #${index}: ${this.currentTitle} (${this.currentUrl})`);
    return { ok: true, title: this.currentTitle, url: this.currentUrl };
  }

  public async quickFillMicrosoftSSO(email = 'marcel.andre@viavarejo.com.br'): Promise<{ ok: boolean; message: string; stage: string }> {
    const page = await this.ensurePage();
    this.log('SSO Automático', `Iniciando preenchimento inteligente Microsoft para ${email}`);

    try {
      const currentUrl = page.url();
      // Se não estiver em login.microsoftonline.com ou login.live.com, navegar
      if (!currentUrl.includes('login.microsoftonline.com') && !currentUrl.includes('login.live.com')) {
        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      }

      // 1. Tentar encontrar campo de e-mail (i0116 / type="email")
      const emailInput = page.locator('input[type="email"], input[name="loginfmt"], #i0116').first();
      if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
        await emailInput.fill(email);
        await new Promise((r) => setTimeout(r, 200));

        // Clicar em Avançar (idSubmit_ProofUp_Redirect ou idSIButton9)
        const nextBtn = page.locator('#idSIButton9, input[type="submit"][value="Avançar"], input[type="submit"][value="Next"]').first();
        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nextBtn.click();
        }
        await new Promise((r) => setTimeout(r, 1200));
        await this.captureScreenshot();
        return {
          ok: true,
          message: `E-mail ${email} inserido com sucesso. Aguardando senha ou solicitação do Authenticator.`,
          stage: 'email_submitted',
        };
      }

      // 2. Verificar se está na tela do Microsoft Authenticator (aprovando com 2 dígitos)
      const mfaCodeElement = page.locator('#idRichContext_DisplaySign, div.displaySign, [data-testid="displaySign"]').first();
      if (await mfaCodeElement.isVisible({ timeout: 2000 }).catch(() => false)) {
        const codeText = (await mfaCodeElement.textContent()) || '';
        await this.captureScreenshot();
        return {
          ok: true,
          message: `Código do Microsoft Authenticator na tela: [${codeText.trim()}]. Digite este número no seu celular.`,
          stage: 'mfa_authenticator_code',
        };
      }

      // 3. Verificar tela "Continuar Conectado? / Stay signed in?"
      const staySignedInBtn = page.locator('#idSIButton9, input[type="submit"][value="Sim"], input[type="submit"][value="Yes"]').first();
      if (await staySignedInBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await staySignedInBtn.click();
        await new Promise((r) => setTimeout(r, 1500));
        await this.captureScreenshot();
        return {
          ok: true,
          message: 'Opção "Continuar conectado" confirmada. Sessão corporativa gravada no perfil persistente!',
          stage: 'stay_signed_in_completed',
        };
      }

      await this.captureScreenshot();
      return {
        ok: true,
        message: 'Tela atual analisada. Se o Authenticator estiver solicitando, veja o número na tela e aprove no seu celular.',
        stage: 'screen_analyzed',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('Falha SSO', msg);
      return { ok: false, message: `Erro ao interagir com tela Microsoft: ${msg}`, stage: 'error' };
    }
  }

  public async navigate(url: string): Promise<{ ok: boolean; title: string; url: string; error?: string }> {
    try {
      const page = await this.ensurePage();
      let target = url.trim();
      if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
        target = 'https://' + target;
      }
      this.log('Navegar', target);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.currentUrl = page.url();
      this.currentTitle = await page.title();
      await this.captureScreenshot();
      return { ok: true, title: this.currentTitle, url: this.currentUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('Erro Navegação', msg);
      return { ok: false, title: this.currentTitle, url: this.currentUrl, error: msg };
    }
  }

  public async captureScreenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      scale: 'css',
    });
    this.lastScreenshot = buffer;
    this.lastScreenshotTime = Date.now();
    return buffer;
  }

  public async getScreenshotCached(): Promise<Buffer> {
    const now = Date.now();
    if (this.lastScreenshot && now - this.lastScreenshotTime < 600) {
      return this.lastScreenshot;
    }
    return this.captureScreenshot();
  }

  public async click(x: number, y: number, button: 'left' | 'right' = 'left') {
    const page = await this.ensurePage();
    this.log('Clique', `Mouse em (${Math.round(x)}, ${Math.round(y)}) [${button}]`);
    await page.mouse.click(x, y, { button });
    // Pequena pausa para permitir renderização de efeitos ou modals
    await new Promise((r) => setTimeout(r, 200));
    this.currentUrl = page.url();
    this.currentTitle = await page.title().catch(() => this.currentTitle);
    await this.captureScreenshot();
    return { ok: true, url: this.currentUrl, title: this.currentTitle };
  }

  public async typeText(text: string) {
    const page = await this.ensurePage();
    this.log('Digitação', `Texto: "${text}"`);
    await page.keyboard.type(text, { delay: 35 });
    await this.captureScreenshot();
    return { ok: true };
  }

  public async pressKey(key: string) {
    const page = await this.ensurePage();
    this.log('Tecla', key);
    await page.keyboard.press(key);
    await this.captureScreenshot();
    return { ok: true };
  }

  public async reload() {
    const page = await this.ensurePage();
    this.log('Recarregar', 'Atualizando página');
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await this.captureScreenshot();
    return { ok: true };
  }

  public async goBack() {
    const page = await this.ensurePage();
    this.log('Voltar', 'Página anterior');
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    this.currentUrl = page.url();
    this.currentTitle = await page.title().catch(() => this.currentTitle);
    await this.captureScreenshot();
    return { ok: true };
  }

  public async goForward() {
    const page = await this.ensurePage();
    this.log('Avançar', 'Página seguinte');
    await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
    this.currentUrl = page.url();
    this.currentTitle = await page.title().catch(() => this.currentTitle);
    await this.captureScreenshot();
    return { ok: true };
  }

  public async inspectElement(x: number, y: number): Promise<ElementInspectionResult> {
    const page = await this.ensurePage();
    const result = await page.evaluate(
      ({ cx, cy }) => {
        const el = document.elementFromPoint(cx, cy);
        if (!el) {
          return {
            tagName: 'BODY',
            id: '',
            className: '',
            text: '',
            selector: 'body',
            suggestedTitle: 'Corpo da Página',
            suggestedDescription: 'Clique geral na página',
          };
        }

        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const dataId = el.getAttribute('data-id') ? `[data-id="${el.getAttribute('data-id')}"]` : '';
        const nameAttr = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : '';
        const textSnippet = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);

        let selector = '';
        if (id) {
          selector = id;
        } else if (dataId) {
          selector = `${tag}${dataId}`;
        } else if (nameAttr) {
          selector = `${tag}${nameAttr}`;
        } else {
          // Fallback CSS path
          const classList = Array.from(el.classList).filter((c) => !c.includes(':')).slice(0, 2);
          const classPart = classList.length ? `.${classList.join('.')}` : '';
          selector = `${tag}${classPart}`;
        }

        let suggestedTitle = 'Clique em ' + tag.toUpperCase();
        let suggestedDescription = `Interação com elemento <${tag}>`;
        if (textSnippet) {
          suggestedTitle = `Clicar em "${textSnippet}"`;
          suggestedDescription = `Seleciona ${textSnippet} na interface`;
        }

        return {
          tagName: tag,
          id: el.id,
          className: el.className,
          text: textSnippet,
          selector,
          suggestedTitle,
          suggestedDescription,
        };
      },
      { cx: x, cy: y }
    );

    return result;
  }

  public async executeWorkflowStep(step: WorkflowStep): Promise<{ ok: boolean; message: string }> {
    const page = await this.ensurePage();
    this.log('Executar Passo', `${step.order}. ${step.label} (${step.cssSelector || step.action})`);

    try {
      // Passos que não dependem de elemento: espera programada e navegação.
      if (step.action === 'sleep') {
        const ms = Number(step.value) || 2000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        this.log('Espera Programada', `${(ms / 1000).toFixed(1)}s`);
        await this.captureScreenshot();
        return { ok: true, message: `Aguardou ${(ms / 1000).toFixed(1)}s conforme programado.` };
      }

      if (step.action === 'navigate') {
        const target = step.value || this.currentUrl;
        if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
          throw new Error(`URL inválida para navegação: ${target}`);
        }
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.currentUrl = page.url();
        this.currentTitle = await page.title().catch(() => this.currentTitle);
        await this.captureScreenshot();
        return { ok: true, message: `Navegou para ${this.currentUrl}` };
      }

      if (!step.cssSelector) {
        throw new Error('Passo sem seletor CSS.');
      }

      const timeout = Math.max(1500, Number(step.timeoutMs) || 8000);
      const locator = page.locator(step.cssSelector).first();
      await locator.waitFor({ state: 'visible', timeout });

      if (step.action === 'click') {
        await locator.click({ timeout });
      } else if (step.action === 'check') {
        if (!(await locator.isChecked().catch(() => false))) {
          await locator.check({ timeout });
        }
      } else if (step.action === 'select') {
        const wanted = step.value || '';
        try {
          await locator.selectOption(wanted, { timeout });
        } catch {
          // Fallback: alguns selects usam rótulo em vez de value
          await locator.selectOption({ label: wanted }, { timeout });
        }
      } else if (step.action === 'fill') {
        await locator.fill(step.value || '', { timeout });
      } else if (step.action === 'wait_visible') {
        // já aguardado acima
      }

      await new Promise((r) => setTimeout(r, 300));
      await this.captureScreenshot();
      return { ok: true, message: `Passo "${step.label}" executado com sucesso.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('Falha no Passo', msg);
      return { ok: false, message: `Falha ao executar passo: ${msg}` };
    }
  }
}

export const browserManager = new RealBrowserManager();
