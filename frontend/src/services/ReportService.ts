import { delay, readJSON, uid, writeJSON } from '@/lib/storage';
import type { QueueRange, Report, ReportAvailability, Availability, StationReport } from '@/types';

const KEY = 'qless.reports';
const STATION_KEY = 'qless.station-reports';

// ReportService — mock crowd-sourced status reports. The UI submits through
// here; the future backend will handle identity, GPS verification, reputation,
// confidence weighting and spam prevention without any UI change.
export const ReportService = {
  // New primary entry point for the "Update Status" flow.
  async submitStationReport(input: {
    stationId: string;
    queueRange: QueueRange;
    availability: Availability;
    pressureValue?: number | null;
    verifiedNearby: boolean;
  }): Promise<StationReport> {
    const report: StationReport = {
      id: uid('rpt'),
      stationId: input.stationId,
      queueRange: input.queueRange,
      availability: input.availability,
      pressureValue: input.pressureValue ?? null,
      verifiedNearby: input.verifiedNearby,
      reportedAt: new Date().toISOString(),
      source: 'community',
    };
    const all = readJSON<StationReport[]>(STATION_KEY, []);
    writeJSON(STATION_KEY, [report, ...all]);
    return delay(report, 500);
  },

  async getLatestReport(stationId: string): Promise<StationReport | null> {
    const all = readJSON<StationReport[]>(STATION_KEY, []);
    const latest = all.find((r) => r.stationId === stationId) ?? null;
    return delay(latest, 200);
  },

  async getStationReports(stationId: string): Promise<StationReport[]> {
    const all = readJSON<StationReport[]>(STATION_KEY, []);
    return delay(all.filter((r) => r.stationId === stationId), 200);
  },

  // Legacy queue report (kept for backward compatibility).
  async submitQueueReport(input: {
    stationId: string;
    available: ReportAvailability;
    queue: QueueRange;
    pressure?: number | null;
    verifiedNearby: boolean;
  }): Promise<Report> {
    const report: Report = {
      id: uid('report'),
      stationId: input.stationId,
      available: input.available,
      queue: input.queue,
      pressure: input.pressure ?? null,
      verifiedNearby: input.verifiedNearby,
      createdAt: new Date().toISOString(),
    };
    const all = readJSON<Report[]>(KEY, []);
    writeJSON(KEY, [report, ...all]);
    return delay(report, 500);
  },
};
