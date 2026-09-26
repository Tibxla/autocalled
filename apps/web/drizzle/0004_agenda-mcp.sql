CREATE TABLE "disponibilites" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"occupations" jsonb NOT NULL,
	"fenetre_debut" timestamp with time zone NOT NULL,
	"fenetre_fin" timestamp with time zone NOT NULL,
	"synchronise_le" timestamp with time zone DEFAULT now() NOT NULL,
	"erreur" text
);
--> statement-breakpoint
ALTER TABLE "rendez_vous" ALTER COLUMN "evenement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD COLUMN "statut" text DEFAULT 'a-creer' NOT NULL;--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD COLUMN "erreur" text;