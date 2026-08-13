import { apiRequest, ApiError } from '@/lib/api/client';
import { toQueueRangeLabel } from '@/lib/api/mappers';
import type {
  Availability,
  Coordinates,
  QueueRange,
  Report,
  ReportAvailability,
  StationReport,
} from '@/types';

// ReportService — crowd-sourced status reports.
//
// The backend derives trust from the submitted coordinates; a client-supplied
// "verified" flag is rejected outright, so `verifiedNearby` is only ever an
// OUTPUT here, never something we send.

interface ApiSubmitResult {
  reportIds: { queue?: string; availability?: string; pressure?: string };
  locationVerified: boolean;
  source: string;
  distanceToStationM: number | null;
}

/** Re-thrown so the UI can show a useful message for throttling. */
export class ReportRejectedError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(code: string, message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'ReportRejectedError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function rethrow(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.code === 'REPORT_COOLDOWN' || error.code === 'DUPLICATE_REPORT') {
      const detail = error.details.find((d) => d.field === 'retryAfterSeconds');
      throw new ReportRejectedError(
        error.code,
        error.message,
        detail ? Number(detail.message) : null,
      );
    }
  }
  throw error;
}

export const ReportService = {
  /**
   * Primary "Update Status" entry point.
   *
   * `coords` is optional but strongly preferred: submitting from within the
   * station's geofence upgrades the report to VERIFIED_NEARBY_USER, which the
   * backend weights considerably higher.
   */
  async submitStationReport(input: {
    stationId: string;
    queueRange: QueueRange;
    availability: Availability;
    pressureValue?: number | null;
    verifiedNearby: boolean;
    coords?: Coordinates | null;
  }): Promise<StationReport> {
    const body: Record<string, unknown> = {};

    // "UNKNOWN" is a real answer and is sent through as-is; the backend stores
    // it as null bounds rather than zero.
    body.queueRange = toQueueRangeLabel(input.queueRange);

    if (input.availability !== 'UNKNOWN') {
      body.availability = input.availability;
    }

    if (input.pressureValue != null) {
      body.pressureValue = input.pressureValue;
    }

    if (input.coords) {
      body.latitude = input.coords.lat;
      body.longitude = input.coords.lng;
    }

    try {
      const result = await apiRequest<ApiSubmitResult>(
        `/stations/${input.stationId}/reports`,
        { method: 'POST', body },
      );

      return {
        id:
          result.reportIds.queue ??
          result.reportIds.availability ??
          result.reportIds.pressure ??
          'report',
        stationId: input.stationId,
        queueRange: input.queueRange,
        availability: input.availability,
        pressureValue: input.pressureValue ?? null,
        // Server-computed, not what the caller claimed.
        verifiedNearby: result.locationVerified,
        reportedAt: new Date().toISOString(),
        source: 'community',
      };
    } catch (error) {
      return rethrow(error);
    }
  },

  async getStationReports(stationId: string): Promise<StationReport[]> {
    try {
      const result = await apiRequest<{
        reports: {
          queue: Array<{
            id: string;
            queueMin: number | null;
            queueMax: number | null;
            queueBucket: string;
            locationVerified: boolean;
            createdAt: string;
          }>;
          availability: Array<{
            id: string;
            availability: Availability;
            locationVerified: boolean;
            createdAt: string;
          }>;
        };
      }>(`/stations/${stationId}/reports`, { auth: false, query: { limit: 20 } });

      // The UI shows one timeline, so queue reports carry it and availability
      // reports fill in where no queue was given.
      const fromQueue: StationReport[] = result.reports.queue.map((r) => ({
        id: r.id,
        stationId,
        queueRange: bucketToRange(r.queueBucket),
        availability: 'UNKNOWN' as Availability,
        pressureValue: null,
        verifiedNearby: r.locationVerified,
        reportedAt: r.createdAt,
        source: 'community' as const,
      }));

      const fromAvailability: StationReport[] = result.reports.availability.map((r) => ({
        id: r.id,
        stationId,
        queueRange: 'UNKNOWN' as QueueRange,
        availability: r.availability,
        pressureValue: null,
        verifiedNearby: r.locationVerified,
        reportedAt: r.createdAt,
        source: 'community' as const,
      }));

      return [...fromQueue, ...fromAvailability].sort(
        (a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime(),
      );
    } catch {
      return [];
    }
  },

  async getLatestReport(stationId: string): Promise<StationReport | null> {
    const reports = await this.getStationReports(stationId);
    return reports[0] ?? null;
  },

  /** Legacy queue-only report, kept for backward compatibility. */
  async submitQueueReport(input: {
    stationId: string;
    available: ReportAvailability;
    queue: QueueRange;
    pressure?: number | null;
    verifiedNearby: boolean;
    coords?: Coordinates | null;
  }): Promise<Report> {
    const availability: Availability =
      input.available === 'YES' ? 'AVAILABLE' : input.available === 'NO' ? 'UNAVAILABLE' : 'UNKNOWN';

    const report = await this.submitStationReport({
      stationId: input.stationId,
      queueRange: input.queue,
      availability,
      pressureValue: input.pressure ?? null,
      verifiedNearby: input.verifiedNearby,
      coords: input.coords ?? null,
    });

    return {
      id: report.id,
      stationId: report.stationId,
      available: input.available,
      queue: input.queue,
      pressure: input.pressure ?? null,
      verifiedNearby: report.verifiedNearby,
      createdAt: report.reportedAt,
    };
  },
};

function bucketToRange(bucket: string): QueueRange {
  switch (bucket) {
    case 'RANGE_0_3':
      return '0-3';
    case 'RANGE_4_7':
      return '4-7';
    case 'RANGE_8_15':
      return '8-15';
    case 'RANGE_16_25':
      return '16-25';
    case 'RANGE_25_PLUS':
      return '25+';
    default:
      return 'UNKNOWN';
  }
}
