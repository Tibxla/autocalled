import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // La configuration ElevenLabs de l'assistante lit et écrit agent/ et parle à ElevenLabs : réservée au serveur MCP,
  // aux scripts, et côté interface à la page Assistante et à ses actions serveur (lib/edition-assistante.ts, décision
  // de l'opérateur du 30/09/2026 : tout s'y règle, sauf le prompt). Importée par un composant client, Turbopack
  // embarquerait node:fs et le paquet @autocalled/agent.
  {
    files: ["src/app/**", "src/components/**"],
    ignores: ["src/app/assistante/page.tsx", "src/app/assistante/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@autocalled/agent", message: "Réservé au serveur MCP et aux scripts (ADR 0010)." },
            { name: "@/lib/configuration-assistante", message: "Réservé au serveur MCP et aux scripts : l'interface passe par @/lib/edition-assistante, depuis la page Assistante et ses actions." },
            { name: "@/lib/edition-assistante", message: "Seules src/app/assistante/page.tsx et actions.ts l'importent : un composant client appelle les actions." },
          ],
          patterns: [
            { group: ["**/lib/configuration-assistante"], message: "Réservé au serveur MCP et aux scripts : l'interface passe par @/lib/edition-assistante." },
            { group: ["**/lib/edition-assistante"], message: "Seules src/app/assistante/page.tsx et actions.ts l'importent." },
          ],
        },
      ],
    },
  },
  // La page Assistante et ses actions : l'édition passe par lib/edition-assistante.ts, jamais directement par la
  // configuration ni par le paquet agent (mêmes fonctions que le MCP, origine « interface »).
  {
    files: ["src/app/assistante/page.tsx", "src/app/assistante/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@autocalled/agent", message: "Réservé au serveur MCP et aux scripts (ADR 0010)." },
            { name: "@/lib/configuration-assistante", message: "La page passe par @/lib/edition-assistante." },
          ],
          patterns: [{ group: ["**/lib/configuration-assistante"], message: "La page passe par @/lib/edition-assistante." }],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
