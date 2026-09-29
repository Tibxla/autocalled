CREATE TABLE "journal_mcp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"le" timestamp with time zone DEFAULT now() NOT NULL,
	"outil" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"resultat" text NOT NULL,
	"message" text,
	"confirmation" text
);
