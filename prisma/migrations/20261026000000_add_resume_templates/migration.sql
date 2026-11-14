-- Add 4 new resume templates (preview + export already accept them)
ALTER TYPE "Template" ADD VALUE IF NOT EXISTS 'EXECUTIVE';
ALTER TYPE "Template" ADD VALUE IF NOT EXISTS 'CREATIVE';
ALTER TYPE "Template" ADD VALUE IF NOT EXISTS 'TECH';
ALTER TYPE "Template" ADD VALUE IF NOT EXISTS 'ELEGANT';
