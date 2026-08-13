import { PressureStatus, PressureUnit } from '@prisma/client';
import { PRESSURE_DEFAULTS } from '../config/constants';

/** Conversion factors to bar, the platform's internal canonical unit. */
const TO_BAR: Record<PressureUnit, number> = {
  [PressureUnit.BAR]: 1,
  [PressureUnit.PSI]: 0.0689476,
  [PressureUnit.KPA]: 0.01,
};

export function toBar(value: number, unit: PressureUnit): number {
  return value * TO_BAR[unit];
}

export function fromBar(valueInBar: number, unit: PressureUnit): number {
  return valueInBar / TO_BAR[unit];
}

export interface StationPressureThresholds {
  /** At or below this (in bar) pressure reads as LOW. */
  low: number;
  /** At or above this (in bar) pressure reads as NORMAL. */
  normal: number;
}

/**
 * Resolves the thresholds to apply for a station.
 *
 * Station-specific configuration always wins; the platform defaults are only a
 * fallback. There is deliberately no universal "good pressure" constant —
 * acceptable pressure differs by equipment and region.
 */
export function resolveThresholds(station: {
  pressureThresholdLow?: number | null;
  pressureThresholdNormal?: number | null;
}): StationPressureThresholds {
  return {
    low: station.pressureThresholdLow ?? PRESSURE_DEFAULTS.thresholdLow,
    normal: station.pressureThresholdNormal ?? PRESSURE_DEFAULTS.thresholdNormal,
  };
}

/**
 * Classifies a pressure reading relative to that station's own thresholds.
 * Values below the low threshold are CRITICAL only once they fall meaningfully
 * under it (25%), so a marginal dip is not over-reported.
 */
export function classifyPressure(
  value: number | null | undefined,
  unit: PressureUnit,
  station: { pressureThresholdLow?: number | null; pressureThresholdNormal?: number | null },
): PressureStatus {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return PressureStatus.UNKNOWN;
  }

  const valueInBar = toBar(value, unit);
  const { low, normal } = resolveThresholds(station);

  if (valueInBar >= normal) return PressureStatus.NORMAL;
  if (valueInBar <= low * 0.75) return PressureStatus.CRITICAL;
  if (valueInBar <= low) return PressureStatus.LOW;
  return PressureStatus.NORMAL;
}

/** Rejects readings that cannot be physically plausible. */
export function isPlausiblePressure(value: number, unit: PressureUnit): boolean {
  const valueInBar = toBar(value, unit);
  return valueInBar >= PRESSURE_DEFAULTS.minAccepted && valueInBar <= PRESSURE_DEFAULTS.maxAccepted;
}
