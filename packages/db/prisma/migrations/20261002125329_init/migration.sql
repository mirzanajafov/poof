CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'REJECTED');

CREATE TYPE "LeaseState" AS ENUM ('PENDING', 'RUNNING', 'DONE');

CREATE TYPE "WorkerExit" AS ENUM ('NORMAL', 'CRASH', 'MEMORY', 'TIMEOUT', 'HEARTBEAT', 'KILLED');

CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "dataset" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "items" INTEGER NOT NULL,
    "policy" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "predictedMs" DOUBLE PRECISION NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "deadLettered" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lease" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "parentId" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "lo" INTEGER NOT NULL,
    "hi" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL,
    "state" "LeaseState" NOT NULL DEFAULT 'PENDING',
    "workerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Worker" (
    "id" UUID NOT NULL,
    "pid" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "exit" "WorkerExit",
    "items" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeadLetter" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "item" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Decision" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "taskId" UUID,
    "detail" JSONB NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BreakerEvent" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,

    CONSTRAINT "BreakerEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_status_idx" ON "Task"("status");

CREATE INDEX "Task_submittedAt_idx" ON "Task"("submittedAt");

CREATE INDEX "Lease_taskId_state_idx" ON "Lease"("taskId", "state");

CREATE UNIQUE INDEX "DeadLetter_taskId_item_key" ON "DeadLetter"("taskId", "item");

CREATE INDEX "Decision_taskId_idx" ON "Decision"("taskId");

CREATE INDEX "Decision_at_idx" ON "Decision"("at");

ALTER TABLE "Lease" ADD CONSTRAINT "Lease_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lease" ADD CONSTRAINT "Lease_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeadLetter" ADD CONSTRAINT "DeadLetter_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Decision" ADD CONSTRAINT "Decision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
