import React, { useState } from 'react';
import { Check, Copy, ExternalLink, FileText, Sparkles, X } from 'lucide-react';

interface MasterPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MASTER_PROMPT_TEXT = `# PROMPT MESTRE DEFINITIVO: PLATAFORMA DE AUTOMAÇÃO RPA DE APROVAÇÕES EM MASSA COM NAVEGADOR INTERNO REAL, EXTENSÃO CHROME E SCRIPTS PYTHON

Atue como um Engenheiro Especialista em Automação RPA, Arquitetura de Software e Experiência do Usuário (No-Code/Low-Code).

Construa uma plataforma web corporativa completa, robusta e intuitiva, projetada para usuários NÃO-TÉCNICOS (como gestores e analistas de IAM/Segurança da Informação), com a finalidade de automatizar a aprovação repetitiva em massa de mais de 400 acessos corporativos (ex: 418 solicitações pendentes no Portal de Acessos/IAM), superando autenticação Microsoft OAuth SSO, Microsoft Authenticator (MFA) e barreiras anti-bot.

---

### 1. OBJETIVO PRINCIPAL & CONTEXTO
- O usuário precisa aprovar diariamente centenas de solicitações individuais de acessos que possuem uma rotina idêntica de cliques:
  1. Localizar o card ou linha da solicitação pendente;
  2. Clicar em "Aprovar Acesso" ou selecionar a caixa de seleção;
  3. Marcar justificativa padrão ("Aprovado conforme perfil da função");
  4. Confirmar no modal de segurança ("Confirmar Aprovação");
  5. Aguardar mensagem de sucesso e avançar para o próximo item.
- A plataforma deve oferecer **três formas intercambiáveis de execução**:
  a) **Navegador Interno Real (Chromium embutido)** direto na interface web, para aprendizado do 1º ciclo e execução supervisionada;
  b) **Extensão de Navegador Chrome/Edge Manifest V3 (MV3)** empacotada em .zip para ser instalada com 1 clique e rodar em segundo plano em qualquer computador corporativo sem precisar instalar Python ou configurar nada;
  c) **Pacote de Scripts Python (Playwright + Selenium)** empacotado em .zip com orquestrador assíncrono, suporte a múltiplos proxies e exportação de logs.

---

### 2. NAVEGADOR INTERNO REAL (CHROMIUM EMBUTIDO & APRENDIZADO POR DEMONSTRAÇÃO)
- Um navegador Chromium real rodando no servidor e espelhado na interface com controle em tempo real (streaming suave de quadros, sem piscar e sem recarregar a tela a todo instante).
- **Modo Aprendizado (Gravação da 1ª Rodada)**:
  - O usuário navega normalmente e clica nos botões da tela para aprovar a primeira solicitação manualmente.
  - A cada clique, o sistema inspeciona o DOM automaticamente, extrai seletores CSS/data-attributes resilientes e cria os passos ordenados do fluxo.
  - O fluxo gravado é sincronizado instantaneamente com o Robô em Lote, com a Extensão Chrome e com o Script Python.
- **Suporte Total a Microsoft OAuth SSO & Microsoft Authenticator**:
  - Perfil de usuário persistente para salvar cookies e tokens corporativos, eliminando a necessidade de logar toda vez.
  - Evasão anti-bot avançada (mascaramento de navigator.webdriver, mock de window.chrome, plugins e cabeçalhos reais).
  - Assistente guiado de login em 5 passos: 1. Abrir Login Microsoft; 2. Preencher e-mail corporativo; 3. Congelar a tela para visualizar com calma o código de 2 dígitos do Microsoft Authenticator e aprovar no celular; 4. Confirmar "Manter conectado"; 5. Voltar ao portal IAM.
  - Gerenciador de múltiplas abas/popups para capturar telas de autenticação federada.

---

### 3. INTERFACE INTUITIVA E AMIGÁVEL PARA USUÁRIOS NÃO-TÉCNICOS
- Zero jargões técnicos complexos: botões grandes, claros e autoexplicativos ("Iniciar 418 Aprovações", "Pausar", "Treinar com 1 Clique").
- Indicadores visuais do progresso: barra de progresso percentual, contador de aprovados, tempo estimado restante e velocidade ajustável (Normal, Rápida 3x, Turbo 8x).
- Gestão de Exceções & Retentativas Automáticas:
  - Se uma página demorar a responder, o robô faz até 3 retentativas automáticas com jitter aleatório para parecer humano.
  - Se um item exigir aprovação superior ou perfil restrito, é isolado com etiqueta amarela e o robô continua sem travar a fila.
  - Botão "Reenfileirar Falhas" para tentar novamente apenas os itens não aprovados.
- Logs em Português Claro e Auditoria:
  - Histórico de cada clique com carimbo de data/hora, nome do colaborador e sistema.
  - Botão para exportar "Relatório de Auditoria Completo em Excel/CSV (.csv)" com hash de rastreabilidade para auditorias de conformidade e segurança da informação.

---

### 4. EXTENSÃO DE NAVEGADOR (CHROME & EDGE MV3) PRONTA PARA BAIXAR
- Um arquivo .zip completo, com manifesto MV3 válido, popup moderno, ícones e script de conteúdo capaz de injetar a automação diretamente no portal da empresa na máquina do usuário.
- O popup da extensão deve conter:
  - Seletor de velocidade;
  - Botão "Iniciar Aprovações na Página Atual";
  - Botão "Gravar Cliques da 1ª Rodada";
  - Contador de itens processados em tempo real.

---

### 5. RESILIÊNCIA ANTI-BOT E PROXIES INTELIGENTES
- Rotação de proxies corporativos e conexões diretas.
- Delays humanos aleatórios configuráveis (ex: entre 200ms e 800ms) para evitar bloqueios por taxa de requisições.
- Tratamento de CAPTCHAs e revalidação de MFA sem perder a sessão.

Construa a solução completa com frontend reativo em React + Tailwind CSS, backend em Node.js com Playwright-core, empacotadores de arquivos .zip em memória e portal corporativo de testes integrado.`;

export function MasterPromptModal({ isOpen, onClose }: MasterPromptModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MASTER_PROMPT_TEXT);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Prompt Mestre Definitivo (AutoApprove RPA)
              </h2>
              <p className="text-xs text-slate-500">
                Prompt completo pronto para replicar ou documentar todo o sistema de automação
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Prompt Mestre</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Box */}
        <div className="p-5 overflow-y-auto flex-1 font-mono text-xs text-slate-700 leading-relaxed bg-slate-950 text-slate-200 p-4 rounded-xl m-4 space-y-3 select-text">
          <pre className="whitespace-pre-wrap font-mono text-[12px]">{MASTER_PROMPT_TEXT}</pre>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50">
          <span>✓ Inclui especificações de Navegador Interno Real, Microsoft SSO MFA, Extensão Chrome e Scripts Python</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
