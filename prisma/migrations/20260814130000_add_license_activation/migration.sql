-- CreateTable
CREATE TABLE "license_activation" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "licenseId" TEXT NOT NULL,
    "licenseeName" TEXT,
    "licenseeEmail" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,

    CONSTRAINT "license_activation_pkey" PRIMARY KEY ("id")
);
