ALTER TABLE "entreprises" ADD COLUMN "modifie_le" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entreprises" ADD COLUMN "modifie_par" text;--> statement-breakpoint
ALTER TABLE "objections" ADD COLUMN "modifie_le" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "objections" ADD COLUMN "modifie_par" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "archive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "versions_script" ADD COLUMN "cree_par" text;--> statement-breakpoint
-- Valeur initiale : une fiche d'entreprise existante n'a pas d'horodatage de modification, sa date de création
-- en tient lieu. Les objections n'ont aucune date : elles gardent now(), posé par le DEFAULT ci-dessus.
-- L'origine des lignes existantes reste inconnue (NULL) : « modifiée ailleurs ».
UPDATE "entreprises" SET "modifie_le" = "cree_le";
