-- Preserve existing attempts before removing assignment relationships.
ALTER TABLE "Teacher" RENAME TO "Professor";
ALTER TABLE "Professor" RENAME COLUMN "email" TO "username";
ALTER TABLE "Professor" RENAME CONSTRAINT "Teacher_pkey" TO "Professor_pkey";
ALTER INDEX "Teacher_email_key" RENAME TO "Professor_username_key";
ALTER TABLE "Attempt" ADD COLUMN "semester" TEXT, ADD COLUMN "year" INTEGER,
 ADD COLUMN "categories" JSONB, ADD COLUMN "percentage" DOUBLE PRECISION,
 ADD COLUMN "timeSpentSeconds" INTEGER;
UPDATE "Attempt" a SET "semester" = CASE WHEN EXTRACT(MONTH FROM a."startedAt") <= 5 THEN 'SPRING' WHEN EXTRACT(MONTH FROM a."startedAt") <= 8 THEN 'SUMMER' ELSE 'FALL' END,
 "year" = EXTRACT(YEAR FROM a."startedAt"),
 "categories" = COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) FROM "Category" c WHERE c."assignmentId"=a."assignmentId"),'[]'::jsonb),
 "percentage" = CASE WHEN a.score IS NOT NULL THEN ROUND(a.score::numeric / a."totalTools" * 100,1) END,
 "timeSpentSeconds" = CASE WHEN a."submittedAt" IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM a."submittedAt"-a."startedAt")) END;
ALTER TABLE "Attempt" ALTER COLUMN "semester" SET NOT NULL, ALTER COLUMN "year" SET NOT NULL, ALTER COLUMN "categories" SET NOT NULL;
ALTER TABLE "AttemptTool" ADD COLUMN "toolName" TEXT, ADD COLUMN "toolLogoPath" TEXT,
 ADD COLUMN "correctCategoryId" TEXT, ADD COLUMN "correctCategoryName" TEXT, ADD COLUMN "selectedCategoryName" TEXT;
UPDATE "AttemptTool" a SET "toolName"=t.name, "correctCategoryId"=c.id,"correctCategoryName"=c.name,
 "selectedCategoryName"=(SELECT name FROM "Category" WHERE id=a."selectedCategoryId")
 FROM "Tool" t JOIN "Category" c ON c.id=t."categoryId" WHERE t.id=a."toolId";
ALTER TABLE "AttemptTool" ALTER COLUMN "toolName" SET NOT NULL, ALTER COLUMN "correctCategoryName" SET NOT NULL,
 ALTER COLUMN "toolId" DROP NOT NULL;
ALTER TABLE "AttemptTool" RENAME COLUMN "position" TO "displayOrder";
ALTER TABLE "AttemptTool" DROP CONSTRAINT "AttemptTool_toolId_fkey", DROP CONSTRAINT "AttemptTool_selectedCategoryId_fkey";
ALTER TABLE "Attempt" DROP COLUMN "assignmentId";
ALTER TABLE "Tool" DROP COLUMN "assignmentId", ADD COLUMN "logoPath" TEXT,
 ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Category" DROP COLUMN "assignmentId",
 ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Merge case-insensitive category duplicates; attempt snapshots keep original IDs/names.
UPDATE "Tool" t SET "categoryId" = (SELECT MIN(c.id) FROM "Category" c WHERE lower(trim(c.name))=lower(trim(old.name))) FROM "Category" old WHERE old.id=t."categoryId";
DELETE FROM "Category" c WHERE c.id <> (SELECT MIN(d.id) FROM "Category" d WHERE lower(trim(d.name))=lower(trim(c.name)));
CREATE UNIQUE INDEX "Category_name_case_insensitive" ON "Category" (lower(trim(name)));
CREATE TABLE "QuizSettings" ("id" INTEGER NOT NULL DEFAULT 1, "toolsPerQuiz" INTEGER NOT NULL, "timeLimitSeconds" INTEGER NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "QuizSettings_pkey" PRIMARY KEY ("id"), CONSTRAINT "QuizSettings_singleton" CHECK (id=1), CONSTRAINT "QuizSettings_positive" CHECK ("toolsPerQuiz">0 AND "timeLimitSeconds">0));
INSERT INTO "QuizSettings" SELECT 1, LEAST(6,GREATEST(1,(SELECT count(*)::int FROM "Tool"))),180,CURRENT_TIMESTAMP;
DROP TABLE "Assignment";
DROP TYPE "AssignmentStatus";
CREATE INDEX "Tool_categoryId_idx" ON "Tool"("categoryId");
CREATE INDEX "Attempt_studentName_idx" ON "Attempt"("studentName");
CREATE INDEX "Attempt_semester_year_idx" ON "Attempt"("semester","year");
CREATE INDEX "Attempt_submittedAt_idx" ON "Attempt"("submittedAt");
CREATE INDEX "Attempt_score_idx" ON "Attempt"("score");
