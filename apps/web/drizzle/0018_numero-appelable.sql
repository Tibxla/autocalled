-- Un numéro valide hors de la liste d'opposition est appelable (ADR 0001) : les deux tables de l'ancien registre
-- des numéros et les colonnes d'import qui y renvoyaient partent. Les colonnes d'abord, les tables ensuite, sans
-- CASCADE : une dépendance imprévue fait échouer la migration au lieu de partir avec. La liste d'opposition reste.
ALTER TABLE "imports" DROP CONSTRAINT "imports_texte_consentement_version_textes_consentement_version_fk";--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN "texte_consentement_version";--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN "canal";--> statement-breakpoint
DROP TABLE "consentements";--> statement-breakpoint
DROP TABLE "textes_consentement";--> statement-breakpoint
-- La raison d'un prospect sauté par une campagne change de nom. Le texte de l'ancienne valeur, entre guillemets, ne
-- peut désigner que ce champ : l'ordre de la file ne bouge pas.
UPDATE "campagnes" SET "entrees" = replace("entrees"::text, '"numero-non-autorise"', '"numero-non-appelable"')::jsonb
WHERE "entrees"::text LIKE '%"numero-non-autorise"%';
