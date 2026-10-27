import type { AutomationStateSnapshot, ExecutionLogEntry } from '../types/automation';
import {
  computeQueueMetrics,
  generateInitialQueue,
  getDefaultConfig,
  getDefaultProxies,
  getDefaultWorkflowSteps,
} from './seedData';

/**
 * Snapshot local usado quando não existe backend Go/Node disponível — caso do
 * deploy estático (Vercel) ou de abrir o build sem o servidor de automação.
 *
 * A interface continua navegável e a geração da extensão (que roda 100% no
 * navegador) segue funcionando; só a execução real fica indisponível.
 */
export function buildLocalSnapshot(): AutomationStateSnapshot {
  const queue = generateInitialQueue();
  const steps = getDefaultWorkflowSteps();
  const proxies = getDefaultProxies();

  const logs: ExecutionLogEntry[] = [
    {
      id: 'local-boot',
      timestamp: new Date().toISOString(),
      level: 'warn',
      message:
        'Modo local: servidor de automação não conectado. A gravação, a execução em lote e o navegador interno precisam do servidor; a geração da extensão funciona normalmente.',
    },
  ];

  return {
    engineStatus: 'idle',
    activeRequestId: null,
    activeStepOrder: null,
    activeChallenge: null,
    startedAt: null,
    config: getDefaultConfig(),
    steps,
    proxies,
    queue,
    logs,
    metrics: computeQueueMetrics(queue),
  };
}
