export type AccessStatus = 'pending' | 'running' | 'approved' | 'retrying' | 'challenge' | 'failed';

export interface AccessStepTrace {
  stepOrder: number;
  label: string;
  selector: string;
  durationMs: number;
  outcome: 'ok' | 'retry' | 'error';
  detail?: string;
}

export interface AccessRequestItem {
  id: string;
  requesterName: string;
  requesterEmail: string;
  department: string;
  targetSystem: string;
  roleProfile: string;
  riskTier: 'Baixo' | 'Médio' | 'Crítico';
  status: AccessStatus;
  attempts: number;
  durationMs: number;
  proxyUsed: string;
  updatedAt: string;
  errorMessage?: string;
  traceHash?: string;
  stepTraces: AccessStepTrace[];
}

export type StepActionType = 'click' | 'check' | 'select' | 'wait_visible' | 'fill' | 'sleep' | 'navigate';

export interface WorkflowStep {
  id: string;
  order: number;
  label: string;
  action: StepActionType;
  cssSelector: string;
  ariaSelector: string;
  value?: string;
  waitBeforeMs: number;
  timeoutMs: number;
  isLoopTarget: boolean;
}

export type AutomationPatternType = 'list_detail_pagination' | 'free_macro' | 'form_submission' | 'data_extraction';

export interface AutomationTask {
  id: string;
  name: string;
  description: string;
  category: string;
  pattern: AutomationPatternType;
  targetUrl: string;
  repeatMode: 'once' | 'loop_list' | 'repeat_n';
  repeatCount?: number;
  steps: WorkflowStep[];
  listConfig?: {
    listRowSelector: string;
    openDetailSelector: string;
    returnMode: 'history_back' | 'click_button' | 'close_tab' | 'auto';
    returnSelector?: string;
    paginationEnabled: boolean;
    itemsPerPage: number;
    nextPageSelector?: string;
  };
}

export interface ProxyEndpoint {
  id: string;
  label: string;
  protocol: 'HTTP' | 'HTTPS' | 'SOCKS5';
  host: string;
  port: number;
  region: string;
  enabled: boolean;
  latencyMs: number;
  successRate: number;
  stickySession: boolean;
  requestsServed: number;
}

export type AuthPersistenceMode = 'persistent_profile' | 'cdp_attach' | 'extension_session';
export type ChallengeResolutionMode = 'human_handoff' | 'external_solver_webhook';

export interface AutomationConfig {
  targetPortalUrl: string;
  rowContainerSelector: string;
  nextPageSelector: string;
  authMode: AuthPersistenceMode;
  profileDirPath: string;
  cdpEndpointUrl: string;
  microsoftTenantHint: string;
  challengeMode: ChallengeResolutionMode;
  solverWebhookUrl: string;
  solverTimeoutSec: number;
  baseDelayMs: number;
  randomJitterMs: number;
  maxRetries: number;
  backoffMultiplier: number;
  batchSpeedMultiplier: 1 | 3 | 8;
  stickyProxyPerOAuthToken: boolean;
  headlessAfterLogin: boolean;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'challenge';

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  stepLabel?: string;
  proxyLabel?: string;
  message: string;
  detail?: string;
}

export type EngineStatus = 'idle' | 'running' | 'paused' | 'awaiting_challenge' | 'completed';

export interface ActiveChallenge {
  id: string;
  requestId: string;
  type: 'captcha_turnstile' | 'microsoft_mfa_refresh';
  promptText: string;
  authenticatorCode?: string;
  triggeredAt: string;
}

export interface QueueMetrics {
  total: number;
  approved: number;
  pending: number;
  running: number;
  retrying: number;
  failed: number;
  challenge: number;
  completionPercent: number;
  avgDurationMs: number;
  estimatedRemainingSec: number;
}

export interface AutomationStateSnapshot {
  engineStatus: EngineStatus;
  activeRequestId: string | null;
  activeStepOrder: number | null;
  activeChallenge: ActiveChallenge | null;
  startedAt: string | null;
  config: AutomationConfig;
  steps: WorkflowStep[];
  proxies: ProxyEndpoint[];
  queue: AccessRequestItem[];
  logs: ExecutionLogEntry[];
  metrics: QueueMetrics;
}
