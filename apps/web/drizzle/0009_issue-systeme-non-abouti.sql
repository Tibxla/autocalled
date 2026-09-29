-- Appels téléphone clos sans conversation : la route de fin posait `issue` seule. Même critère exact que
-- cette route (terminé, sans conversation ni bilan, issue « non-abouti »), aucune autre ligne touchée.
UPDATE "appels"
SET "issue_systeme" = 'non-abouti'
WHERE "statut" = 'termine'
  AND "issue" = 'non-abouti'
  AND "issue_systeme" IS NULL
  AND "conversation_id" IS NULL
  AND "bilan" IS NULL;
