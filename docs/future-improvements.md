# Améliorations futures

- **Imports du domaine en `.js`.** `packages/domain` importe ses modules en `./numero.js` (convention NodeNext). Vitest et Next remappent vers les `.ts`, mais le type stripping natif de Node ne le fait pas : un script Node qui importerait `@autocalled/domain` directement échouerait (`ERR_MODULE_NOT_FOUND`). Passer aux imports `.ts` avec `rewriteRelativeImportExtensions` le jour où ça arrive.
- **`voicemail_detection` hors téléphonie.** L'outil est activé, mais son comportement sur une conversation WebSocket (le chemin du pont Bluetooth) n'est pas vérifié. À tester pendant le spike ; repli : `end_call` déclenché par le prompt.
