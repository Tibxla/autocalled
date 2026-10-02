-- Le sens d'un appel (ADR 0018) : l'assistante appelle (`sortant`), ou un prospect rappelle le téléphone passerelle
-- (`entrant`). Tous les appels déjà enregistrés sont sortants : le défaut les pose, sans UPDATE.
CREATE TYPE "public"."sens_appel" AS ENUM('sortant', 'entrant');--> statement-breakpoint
ALTER TABLE "appels" ADD COLUMN "sens" "sens_appel" DEFAULT 'sortant' NOT NULL;
