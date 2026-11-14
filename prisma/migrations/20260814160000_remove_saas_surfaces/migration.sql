-- Removes the SaaS-oriented surfaces: support tickets, IP moderation, user
-- suspension and maintenance mode. `users.emailVerified` is deliberately kept:
-- the Auth.js Prisma adapter reads and writes it on every OAuth link.

-- Support tickets. Child table first: ticket_messages.ticketId references
-- support_tickets(id).
DROP TABLE IF EXISTS "ticket_messages";
DROP TABLE IF EXISTS "support_tickets";
DROP TYPE IF EXISTS "TicketStatus";

-- IP moderation.
DROP TABLE IF EXISTS "banned_ips";

-- Maintenance mode.
DROP TABLE IF EXISTS "maintenance_settings";

-- User suspension.
ALTER TABLE "users" DROP COLUMN IF EXISTS "suspendedAt";
ALTER TABLE "users" DROP COLUMN IF EXISTS "suspendedReason";
