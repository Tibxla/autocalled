CREATE TABLE "oppositions" (
	"empreinte" text PRIMARY KEY NOT NULL,
	"temoin" boolean DEFAULT false NOT NULL,
	"le" timestamp with time zone DEFAULT now() NOT NULL,
	"par" text,
	"bilan" jsonb
);
--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "archive_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "archive_par" text;