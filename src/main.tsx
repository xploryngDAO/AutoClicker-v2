import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installLocalApiBridge } from './lib/localApiBridge.ts';
import { resumeIfInterrupted } from './lib/localEngine.ts';

const root = createRoot(document.getElementById('root')!);

async function boot() {
  try {
    await installLocalApiBridge();
  } catch {
    // Sem ponte local, o app segue tentando a API real.
  }

  // Se a aba foi recarregada no meio de uma execução local, retoma de onde parou.
  resumeIfInterrupted();

  root.render(<App />);
}

void boot();
