CREATE TYPE "public"."ligne" AS ENUM('navigateur', 'simulation', 'bluetooth', 'twilio');--> statement-breakpoint
CREATE TYPE "public"."statut_appel" AS ENUM('en-cours', 'traitement', 'termine', 'echec');--> statement-breakpoint
CREATE TABLE "appels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"prospect_id" text NOT NULL,
	"version_script_id" uuid NOT NULL,
	"campagne_id" uuid,
	"ligne" "ligne" NOT NULL,
	"numero" text NOT NULL,
	"conversation_id" text,
	"version_agent" text,
	"statut" "statut_appel" DEFAULT 'en-cours' NOT NULL,
	"debut_le" timestamp with time zone DEFAULT now() NOT NULL,
	"fin_le" timestamp with time zone,
	"duree_secondes" integer,
	"transcription" jsonb,
	"audio" text,
	"bilan" jsonb,
	"issue" text,
	"issue_systeme" "issue_systeme",
	"version_analyseur" text,
	"erreur" text,
	CONSTRAINT "appels_conversationId_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "campagnes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"version_script_id" uuid NOT NULL,
	"ligne" "ligne" NOT NULL,
	"statut" text NOT NULL,
	"entrees" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appels" ADD CONSTRAINT "appels_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appels" ADD CONSTRAINT "appels_version_script_id_versions_script_id_fk" FOREIGN KEY ("version_script_id") REFERENCES "public"."versions_script"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appels" ADD CONSTRAINT "appels_campagne_id_campagnes_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."campagnes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campagnes" ADD CONSTRAINT "campagnes_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campagnes" ADD CONSTRAINT "campagnes_version_script_id_versions_script_id_fk" FOREIGN KEY ("version_script_id") REFERENCES "public"."versions_script"("id") ON DELETE no action ON UPDATE no action;