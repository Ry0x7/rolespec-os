/*
  Warnings:

  - You are about to drop the `portfolio_critiques` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "portfolio_critiques" DROP CONSTRAINT "portfolio_critiques_userId_fkey";

-- DropTable
DROP TABLE "portfolio_critiques";
