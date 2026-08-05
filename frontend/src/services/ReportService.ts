import { delay, readJSON, uid, writeJSON } from '@/lib/storage';
import type { QueueRange, Report, ReportAvailability } from '@/types';

const KEY = 'qless.reports';

// ReportService — mock crowd-sourced status reports.
export const ReportService = {
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

  async getReports(stationId: string): Promise<Report[]> {
    const all = readJSON<Report[]>(KEY, []);
    return delay(
      all.filter((r) => r.stationId === stationId),
      250,
    );
  },
};
