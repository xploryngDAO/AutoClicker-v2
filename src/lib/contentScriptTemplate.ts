import { CONTENT_JS } from './generated/templateStrings.ts';

/**
 * Content script da extensão (motor de gravação/execução).
 *
 * O código-fonte real vive em `src/lib/templates/content.js` e é validado
 * sintaticamente por `scripts/build-templates.mjs` antes de ser embutido aqui.
 * Editar este arquivo não tem efeito: altere o template e rode `npm run gen`.
 */
export function generateContentJs(): string {
  return CONTENT_JS;
}
