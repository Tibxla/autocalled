import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // La configuration ElevenLabs de l'assistante lit et écrit agent/ et parle à ElevenLabs : réservée au serveur MCP
  // et aux scripts. Importée par une page, Turbopack embarquerait node:fs et le paquet @autocalled/agent.
  {
    files: ["src/app/**", "src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@autocalled/agent", message: "Réservé au serveur MCP et aux scripts (ADR 0010)." },
            { name: "@/lib/configuration-assistante", message: "Réservé au serveur MCP et aux scripts : l'interface lit @/lib/assistante." },
          ],
          patterns: [{ group: ["**/lib/configuration-assistante"], message: "Réservé au serveur MCP et aux scripts : l'interface lit @/lib/assistante." }],
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
