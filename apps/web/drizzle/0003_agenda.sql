CREATE TABLE "connexion_google" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text,
	"jeton_chiffre" text NOT NULL,
	"calendrier_id" text NOT NULL,
	"connecte_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rendez_vous" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appel_id" uuid NOT NULL,
	"debut" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"evenement_id" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_appel_id_appels_id_fk" FOREIGN KEY ("appel_id") REFERENCES "public"."appels"("id") ON DELETE cascade ON UPDATE no action;