-- Record how many dispensers were serving at the moment of an availability
-- report. Nullable: only operators reliably know this, so user reports leave
-- it unset rather than guessing a number.
ALTER TABLE "availability_reports" ADD COLUMN "activeDispensers" INTEGER;
