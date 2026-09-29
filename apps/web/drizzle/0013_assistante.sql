CREATE TABLE "assistante" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"nom" text DEFAULT 'Mina' NOT NULL,
	"premier_message" text DEFAULT 'Allô ?' NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_par" text,
	CONSTRAINT "assistante_une_seule_ligne" CHECK ("assistante"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "versions_assistante" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" text NOT NULL,
	"empreinte" text NOT NULL,
	"prompt" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"origine" text NOT NULL,
	"consigne_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_assistante_versionId_unique" UNIQUE("version_id")
);
--> statement-breakpoint
ALTER TABLE "appels" ADD COLUMN "assistante_nom" text;--> statement-breakpoint
-- À la main : la ligne unique de l'assistante, le nom des appels passés (tous par Mina), et un texte de
-- consentement qui ne nomme plus l'assistante. Les consentements déjà donnés gardent leur version 1.
INSERT INTO "assistante" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "appels" SET "assistante_nom" = 'Mina' WHERE "assistante_nom" IS NULL;--> statement-breakpoint
INSERT INTO "textes_consentement" ("version", "texte") VALUES (
  2,
  'J''accepte d''être appelé(e) par une assistante vocale IA, dans le cadre d''une démonstration d''Autocalled, et que ces appels soient enregistrés et analysés. Je peux retirer mon accord à tout moment, et mon numéro ne sera alors plus jamais appelé.'
);
