CREATE TABLE "reglages_automatisation" (
	"cle" text PRIMARY KEY NOT NULL,
	"valeur" jsonb NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
