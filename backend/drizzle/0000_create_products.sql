CREATE TABLE "products" (
	"id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"model_path" text NOT NULL,
	"dimensions_mm" jsonb NOT NULL,
	"dimensions_source" text NOT NULL,
	"bridge_origin_mm" jsonb NOT NULL,
	"anchors" jsonb NOT NULL,
	"attribution" jsonb NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
