ALTER TABLE "entreprises" ADD COLUMN "interlocuteur" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD COLUMN "lien_visio" text;