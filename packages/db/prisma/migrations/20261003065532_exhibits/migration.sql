CREATE TYPE "ExhibitStatus" AS ENUM ('RUNNING', 'DONE', 'ABORTED');

ALTER TABLE "Task" ADD COLUMN     "exhibitId" UUID;

CREATE TABLE "Exhibit" (
    "id" UUID NOT NULL,
    "policy" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "ExhibitStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "stats" JSONB,

    CONSTRAINT "Exhibit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Task" ADD CONSTRAINT "Task_exhibitId_fkey" FOREIGN KEY ("exhibitId") REFERENCES "Exhibit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
