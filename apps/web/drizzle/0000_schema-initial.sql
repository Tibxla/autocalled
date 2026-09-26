CREATE TYPE "public"."issue_systeme" AS ENUM('rendez-vous-pris', 'rappel-convenu', 'envoi-informations', 'refus', 'pas-le-bon-interlocuteur', 'interrompu', 'non-abouti');--> statement-breakpoint
CREATE TABLE "consentements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"texte_version" integer NOT NULL,
	"import_id" uuid NOT NULL,
	"accorde_le" timestamp with time zone DEFAULT now() NOT NULL,
	"revoque_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"offre" text DEFAULT '' NOT NULL,
	"cible" text DEFAULT '' NOT NULL,
	"arguments" text DEFAULT '' NOT NULL,
	"prix_consigne" text DEFAULT '' NOT NULL,
	"interdits" text DEFAULT '' NOT NULL,
	"duree_rendez_vous_minutes" integer DEFAULT 30 NOT NULL,
	"plages_rendez_vous" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delai_minimum_heures" integer DEFAULT 24 NOT NULL,
	"horizon_jours" integer DEFAULT 14 NOT NULL,
	"fuseau" text DEFAULT 'Europe/Paris' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entreprises_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"texte_consentement_version" integer NOT NULL,
	"nombre_fiches" integer NOT NULL,
	"importe_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues_personnalisees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"issue_systeme" "issue_systeme" NOT NULL,
	"archivee" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"creuser" text DEFAULT '' NOT NULL,
	"reformuler" text DEFAULT '' NOT NULL,
	"argumenter" text DEFAULT '' NOT NULL,
	"controler" text DEFAULT '' NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL,
	"archivee" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"entreprise_id" uuid NOT NULL,
	"id" text NOT NULL,
	"nom" text NOT NULL,
	"societe" text,
	"role" text,
	"telephone" text NOT NULL,
	"contexte" text NOT NULL,
	"import_id" uuid,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_entreprise_id_id_pk" PRIMARY KEY("entreprise_id","id")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textes_consentement" (
	"version" integer PRIMARY KEY NOT NULL,
	"texte" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions_script" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"etapes" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_script_scriptId_numero_unique" UNIQUE("script_id","numero")
);
--> statement-breakpoint
ALTER TABLE "consentements" ADD CONSTRAINT "consentements_texte_version_textes_consentement_version_fk" FOREIGN KEY ("texte_version") REFERENCES "public"."textes_consentement"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentements" ADD CONSTRAINT "consentements_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_texte_consentement_version_textes_consentement_version_fk" FOREIGN KEY ("texte_consentement_version") REFERENCES "public"."textes_consentement"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues_personnalisees" ADD CONSTRAINT "issues_personnalisees_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objections" ADD CONSTRAINT "objections_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions_script" ADD CONSTRAINT "versions_script_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;