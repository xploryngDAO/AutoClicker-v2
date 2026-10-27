import type {
  AccessRequestItem,
  AccessStatus,
  AutomationConfig,
  ProxyEndpoint,
  QueueMetrics,
  StepActionType,
  WorkflowStep,
} from '../types/automation.ts';

const FIRST_NAMES = [
  'Mariana', 'Rafael', 'Camila', 'Thiago', 'Beatriz', 'Lucas', 'Fernanda', 'Gustavo',
  'Juliana', 'Bruno', 'Larissa', 'Diego', 'Patrícia', 'Rodrigo', 'Aline', 'Felipe',
  'Carolina', 'Vitor', 'Letícia', 'André', 'Natália', 'Eduardo', 'Bianca', 'Daniel',
  'Vanessa', 'Leonardo', 'Priscila', 'Henrique', 'Renata', 'Marcelo',
];

const LAST_NAMES = [
  'Costa', 'Almeida', 'Oliveira', 'Santos', 'Pereira', 'Ferreira', 'Rodrigues', 'Gomes',
  'Martins', 'Rocha', 'Ribeiro', 'Carvalho', 'Mendes', 'Nogueira', 'Barbosa', 'Teixeira',
  'Moreira', 'Cardoso', 'Monteiro', 'Araújo',
];

const DEPARTMENTS = [
  'Logística & Supply Chain',
  'Planejamento Tributário',
  'Prevenção a Fraudes',
  'Engenharia de Dados',
  'Operações Omnichannel',
  'Tesouraria Corporativa',
  'Atendimento & CRM',
  'Infraestrutura Cloud',
];

const TARGET_SYSTEMS: Array<{ system: string; role: string; risk: 'Baixo' | 'Médio' | 'Crítico' }> = [
  { system: 'SAP S/4HANA Produção', role: 'Leitura Razão Contábil (FI-GL)', risk: 'Médio' },
  { system: 'Azure Databricks Lakehouse', role: 'Workspace Consumer · Catálogo Vendas', risk: 'Baixo' },
  { system: 'Microsoft Entra ID · Grupos', role: 'Operador de Catálogo B2B', risk: 'Médio' },
  { system: 'Salesforce Service Cloud', role: 'Analista N2 · Pós-Venda', risk: 'Baixo' },
  { system: 'ServiceNow GRC & Auditoria', role: 'Aprovador de Mudanças (CAB)', risk: 'Crítico' },
  { system: 'Power BI Corporativo', role: 'Visualizador · Torre de Controle', risk: 'Baixo' },
  { system: 'AWS IAM Identity Center', role: 'ReadOnlyAccess · Cluster EKS', risk: 'Médio' },
  { system: 'Portal WMS CD Jundiaí', role: 'Supervisor de Expedição', risk: 'Baixo' },
];

export const DEFAULT_TOTAL_QUEUE_COUNT = 418;

export function normalizeSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.');
}

export function generateInitialQueue(count: number = DEFAULT_TOTAL_QUEUE_COUNT): AccessRequestItem[] {
  const items: AccessRequestItem[] = [];
  const baseTimestamp = new Date('2026-10-26T10:00:00.000Z').getTime();

  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
    const dept = DEPARTMENTS[(i * 3) % DEPARTMENTS.length];
    const target = TARGET_SYSTEMS[(i * 5 + 1) % TARGET_SYSTEMS.length];
    const idNum = String(i + 1).padStart(4, '0');
    const email = `${normalizeSlug(first)}.${normalizeSlug(last)}${i >= 60 ? (i % 19) + 1 : ''}@corp.empresa.com.br`;

    items.push({
      id: `IAM-2026-${idNum}`,
      requesterName: `${first} ${last}`,
      requesterEmail: email,
      department: dept,
      targetSystem: target.system,
      roleProfile: target.role,
      riskTier: target.risk,
      status: 'pending',
      attempts: 0,
      durationMs: 0,
      proxyUsed: '—',
      updatedAt: new Date(baseTimestamp - (count - i) * 14000).toISOString(),
      stepTraces: [],
    });
  }

  return items;
}

export function getDefaultWorkflowSteps(): WorkflowStep[] {
  return [
    {
      id: 'step-1',
      order: 1,
      label: 'Selecionar linha da solicitação pendente na grade',
      action: 'click',
      cssSelector: 'tr[data-request-status="pending"]:first-of-type',
      ariaSelector: 'role=row[name=/IAM-2026/i]',
      waitBeforeMs: 280,
      timeoutMs: 8000,
      isLoopTarget: true,
    },
    {
      id: 'step-2',
      order: 2,
      label: 'Marcar aceite de conformidade LGPD / Governança',
      action: 'check',
      cssSelector: 'input[data-testid="policy-compliance-checkbox"]',
      ariaSelector: 'role=checkbox[name="Confirmo revisão de alçada e conformidade"]',
      waitBeforeMs: 240,
      timeoutMs: 5000,
      isLoopTarget: true,
    },
    {
      id: 'step-3',
      order: 3,
      label: 'Selecionar vigência padrão de concessão (90 dias)',
      action: 'select',
      cssSelector: 'select[data-testid="grant-duration-select"]',
      ariaSelector: 'role=combobox[name="Vigência da concessão"]',
      value: '90d',
      waitBeforeMs: 220,
      timeoutMs: 5000,
      isLoopTarget: true,
    },
    {
      id: 'step-4',
      order: 4,
      label: 'Acionar botão primário Aprovar Concessão',
      action: 'click',
      cssSelector: 'button[data-action="approve-access"]',
      ariaSelector: 'role=button[name="Aprovar Concessão"]',
      waitBeforeMs: 320,
      timeoutMs: 6000,
      isLoopTarget: true,
    },
    {
      id: 'step-5',
      order: 5,
      label: 'Confirmar efetivação no diálogo de auditoria',
      action: 'click',
      cssSelector: 'button[data-action="confirm-modal-submit"]',
      ariaSelector: 'role=button[name="Confirmar e Assinar"]',
      waitBeforeMs: 300,
      timeoutMs: 8000,
      isLoopTarget: true,
    },
  ];
}

export function getDefaultProxies(): ProxyEndpoint[] {
  return [
    {
      id: 'px-br-sp1',
      label: 'Gateway Corporativo SP-01 (Sticky OAuth)',
      protocol: 'HTTPS',
      host: '10.148.20.41',
      port: 8443,
      region: 'São Paulo · BR-South',
      enabled: true,
      latencyMs: 18,
      successRate: 99.8,
      stickySession: true,
      requestsServed: 0,
    },
    {
      id: 'px-br-sp2',
      label: 'Gateway Corporativo SP-02 (Failover)',
      protocol: 'HTTPS',
      host: '10.148.20.42',
      port: 8443,
      region: 'Barueri · BR-South',
      enabled: true,
      latencyMs: 24,
      successRate: 99.4,
      stickySession: true,
      requestsServed: 0,
    },
    {
      id: 'px-br-rj1',
      label: 'Egress Residencial Dedicado RJ-01',
      protocol: 'SOCKS5',
      host: '172.26.88.14',
      port: 1080,
      region: 'Rio de Janeiro · BR-SE',
      enabled: true,
      latencyMs: 37,
      successRate: 98.7,
      stickySession: false,
      requestsServed: 0,
    },
    {
      id: 'px-us-east',
      label: 'Rota Backup Entra ID US-East',
      protocol: 'HTTPS',
      host: '198.51.100.74',
      port: 3128,
      region: 'Virginia · US-East',
      enabled: false,
      latencyMs: 112,
      successRate: 97.9,
      stickySession: false,
      requestsServed: 0,
    },
  ];
}

export function getDefaultConfig(): AutomationConfig {
  return {
    targetPortalUrl: 'https://governanca.empresa.com.br/iam/aprovacoes-pendentes',
    rowContainerSelector: 'tr[data-request-status="pending"]',
    nextPageSelector: 'button[aria-label="Próxima página"]',
    authMode: 'persistent_profile',
    profileDirPath: './.ms_oauth_profile_corp',
    cdpEndpointUrl: 'http://127.0.0.1:9222',
    microsoftTenantHint: 'marcel.andre@viavarejo.com.br',
    challengeMode: 'human_handoff',
    solverWebhookUrl: 'https://interno.empresa.com.br/rpa/challenge-callback',
    solverTimeoutSec: 45,
    baseDelayMs: 420,
    randomJitterMs: 380,
    maxRetries: 3,
    backoffMultiplier: 2,
    batchSpeedMultiplier: 3,
    stickyProxyPerOAuthToken: true,
    headlessAfterLogin: false,
  };
}

export function computeQueueMetrics(queue: AccessRequestItem[]): QueueMetrics {
  let approved = 0;
  let pending = 0;
  let running = 0;
  let retrying = 0;
  let failed = 0;
  let challenge = 0;
  let durationSum = 0;
  let completedWithDuration = 0;

  for (const item of queue) {
    switch (item.status) {
      case 'approved':
        approved++;
        if (item.durationMs > 0) {
          durationSum += item.durationMs;
          completedWithDuration++;
        }
        break;
      case 'pending':
        pending++;
        break;
      case 'running':
        running++;
        break;
      case 'retrying':
        retrying++;
        break;
      case 'failed':
        failed++;
        break;
      case 'challenge':
        challenge++;
        break;
    }
  }

  const total = queue.length;
  const processed = approved + failed;
  const completionPercent = total === 0 ? 0 : Math.round((approved / total) * 1000) / 10;
  const avgDurationMs =
    completedWithDuration > 0 ? Math.round(durationSum / completedWithDuration) : 1350;
  const remainingItems = pending + running + retrying + challenge;
  const estimatedRemainingSec = Math.max(0, Math.round((remainingItems * avgDurationMs) / 1000));

  return {
    total,
    approved,
    pending,
    running,
    retrying,
    failed,
    challenge,
    completionPercent,
    avgDurationMs,
    estimatedRemainingSec,
  };
}

export function filterQueueItems(
  queue: AccessRequestItem[],
  statusFilter: 'all' | AccessStatus,
  searchQuery: string
): AccessRequestItem[] {
  const q = searchQuery.trim().toLowerCase();
  return queue.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) {
      return false;
    }
    if (!q) return true;
    return (
      item.id.toLowerCase().includes(q) ||
      item.requesterName.toLowerCase().includes(q) ||
      item.requesterEmail.toLowerCase().includes(q) ||
      item.targetSystem.toLowerCase().includes(q) ||
      item.roleProfile.toLowerCase().includes(q) ||
      item.department.toLowerCase().includes(q)
    );
  });
}

export interface RecordedDomInteraction {
  label: string;
  action: StepActionType;
  tagName: string;
  dataAction?: string;
  dataTestId?: string;
  ariaLabel?: string;
  value?: string;
  elapsedSincePrevMs: number;
}

export function synthesizeRecordedStep(
  interaction: RecordedDomInteraction,
  order: number
): WorkflowStep {
  const tag = interaction.tagName.toLowerCase();
  let cssSelector = tag;
  if (interaction.dataAction) {
    cssSelector = `${tag}[data-action="${interaction.dataAction}"]`;
  } else if (interaction.dataTestId) {
    cssSelector = `${tag}[data-testid="${interaction.dataTestId}"]`;
  }

  const roleMap: Record<string, string> = {
    button: 'button',
    tr: 'row',
    input: interaction.action === 'check' ? 'checkbox' : 'textbox',
    select: 'combobox',
  };
  const roleName = roleMap[tag] || 'generic';
  const ariaSelector = interaction.ariaLabel
    ? `role=${roleName}[name="${interaction.ariaLabel}"]`
    : cssSelector;

  const clampedWait = Math.min(2500, Math.max(180, Math.round(interaction.elapsedSincePrevMs)));

  return {
    id: `rec-step-${order}-${Date.now().toString(36)}`,
    order,
    label: interaction.label,
    action: interaction.action,
    cssSelector,
    ariaSelector,
    value: interaction.value,
    waitBeforeMs: clampedWait,
    timeoutMs: 7000,
    isLoopTarget: true,
  };
}

export function getDefaultTasks(): import('../types/automation').AutomationTask[] {
  return [
    {
      id: 'task-iam-approvals',
      name: 'Aprovação de Acessos IAM em Lote (418 Itens)',
      description: 'Itera sobre solicitações pendentes, abre subpágina/modal, assina conformidade, concede vigência de 90 dias e avança páginas.',
      category: 'Segurança & IAM',
      pattern: 'list_detail_pagination',
      targetUrl: 'http://localhost:3000/iam-portal.html',
      repeatMode: 'loop_list',
      repeatCount: 418,
      steps: getDefaultWorkflowSteps(),
      listConfig: {
        listRowSelector: 'tr.linha-solicitacao-pendente, tr[data-status="pending"]',
        openDetailSelector: 'button[data-action="abrir-detalhe"], button.btn-abrir-detalhe, .btn-primary',
        returnMode: 'auto',
        returnSelector: 'button#btn-cancelar-aprovacao, button.btn-voltar',
        paginationEnabled: true,
        itemsPerPage: 10,
        nextPageSelector: 'button#btn-proxima-pagina, a.pagination-next',
      },
    },
    {
      id: 'task-report-export',
      name: 'Exportação Periódica de Relatórios Financeiros',
      description: 'Navega até o módulo de relatórios, filtra por período contábil, seleciona formato Excel XLSX e dispara o download.',
      category: 'Finanças & Controladoria',
      pattern: 'free_macro',
      targetUrl: 'https://portal.empresa.com.br/relatorios',
      repeatMode: 'once',
      steps: [
        {
          id: 'step-rep-1',
          order: 1,
          label: 'Acessar menu Relatórios Gerenciais',
          action: 'click',
          cssSelector: 'a[href*="/relatorios"], button#menu-relatorios',
          ariaSelector: 'role=link[name="Relatórios"]',
          waitBeforeMs: 500,
          timeoutMs: 8000,
          isLoopTarget: false,
        },
        {
          id: 'step-rep-2',
          order: 2,
          label: 'Selecionar período: "Último Trimestre"',
          action: 'select',
          cssSelector: 'select#periodo-filtro, select[name="filtroPeriodo"]',
          ariaSelector: 'role=combobox[name="Período"]',
          value: 'trimestre_anterior',
          waitBeforeMs: 300,
          timeoutMs: 5000,
          isLoopTarget: false,
        },
        {
          id: 'step-rep-3',
          order: 3,
          label: 'Clicar em Gerar e Exportar Planilha Excel (.xlsx)',
          action: 'click',
          cssSelector: 'button#btn-exportar-excel, button[data-action="export-xlsx"]',
          ariaSelector: 'role=button[name="Exportar Excel"]',
          waitBeforeMs: 400,
          timeoutMs: 12000,
          isLoopTarget: false,
        },
      ],
    },
    {
      id: 'task-supplier-registry',
      name: 'Cadastro em Lote de Fornecedores / Colaboradores',
      description: 'Preenche múltiplos formulários com Razão Social, CNPJ, dados bancários e termo de homologação.',
      category: 'Compras & Suprimentos',
      pattern: 'form_submission',
      targetUrl: 'https://compras.empresa.com.br/fornecedores/novo',
      repeatMode: 'repeat_n',
      repeatCount: 50,
      steps: [
        {
          id: 'step-sup-1',
          order: 1,
          label: 'Preencher CNPJ / Matrícula',
          action: 'fill',
          cssSelector: 'input#input-cnpj, input[name="documento"]',
          ariaSelector: 'role=textbox[name="Documento"]',
          value: '33.041.260/0652-90',
          waitBeforeMs: 250,
          timeoutMs: 5000,
          isLoopTarget: true,
        },
        {
          id: 'step-sup-2',
          order: 2,
          label: 'Clicar em Consultar na Receita Federal',
          action: 'click',
          cssSelector: 'button#btn-consultar-cnpj',
          ariaSelector: 'role=button[name="Consultar"]',
          waitBeforeMs: 400,
          timeoutMs: 10000,
          isLoopTarget: true,
        },
        {
          id: 'step-sup-3',
          order: 3,
          label: 'Salvar e Concluir Homologação',
          action: 'click',
          cssSelector: 'button#btn-salvar-homologacao, button[type="submit"]',
          ariaSelector: 'role=button[name="Salvar"]',
          waitBeforeMs: 300,
          timeoutMs: 8000,
          isLoopTarget: true,
        },
      ],
    },
    {
      id: 'task-free-recorder',
      name: 'Macro Universal Livre (Gravação de Qualquer Tarefa)',
      description: 'Modo livre sem restrições. Você clica na tela e o robô aprende exatamente a sequência que você realizou.',
      category: 'Universal / Personalizado',
      pattern: 'free_macro',
      targetUrl: 'about:blank',
      repeatMode: 'repeat_n',
      repeatCount: 1,
      steps: [],
    },
  ];
}
