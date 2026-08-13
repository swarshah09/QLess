-- Align SupplyEventType with the operator-facing vocabulary.
--
-- RENAME VALUE is used rather than dropping and recreating the type so that
-- existing supply_events rows keep their meaning: nothing is deleted and no
-- row needs rewriting. Duplicating the concepts (keeping REFILL_RECEIVED
-- alongside a new SUPPLY_ARRIVED) was rejected — two spellings of one
-- real-world occurrence would fragment every future aggregation.

ALTER TYPE "SupplyEventType" RENAME VALUE 'REFILL_RECEIVED' TO 'SUPPLY_ARRIVED';
ALTER TYPE "SupplyEventType" RENAME VALUE 'SUPPLY_INTERRUPTED' TO 'TEMPORARY_INTERRUPTION';

-- Genuinely new states with no existing equivalent.
ALTER TYPE "SupplyEventType" ADD VALUE IF NOT EXISTS 'LOW_SUPPLY';
ALTER TYPE "SupplyEventType" ADD VALUE IF NOT EXISTS 'CNG_FINISHED';
