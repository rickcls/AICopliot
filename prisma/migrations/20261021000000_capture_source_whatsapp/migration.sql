-- A WhatsApp chat the person exported or pasted becomes a capture of its own
-- kind. Alone in its file: Postgres refuses to use an enum value in the
-- transaction that added it.
ALTER TYPE "CaptureSource" ADD VALUE 'whatsapp';
