import type { Availability, QueueBucket } from '@prisma/client';
import { REPORT_LIMITS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { reportRepository } from '../repositories/report.repository';

/**
 * Abuse controls for crowd reporting.
 *
 * These are database-backed rather than IP-based on purpose: the limit that
 * matters is per *account* per *station*, which an IP-keyed limiter cannot
 * express — one user on mobile data moves between IPs, and a whole office
 * shares one. The IP limiter in `middleware/rateLimiter` still runs in front of
 * this as a coarse first line of defence.
 *
 * Four independent checks:
 *   1. Global cooldown  — no burst across stations.
 *   2. Station cooldown — no rapid re-reporting of one station.
 *   3. Hourly caps      — bounded total volume, per station and overall.
 *   4. Duplicate window — identical repeat submissions are not new evidence.
 */

export interface ThrottleSubject {
  userId: string;
  stationId: string;
  queueBucket?: QueueBucket;
  availability?: Availability;
  pressureValue?: number;
}

function secondsUntil(from: Date, cooldownSeconds: number, now: Date): number {
  const elapsed = (now.getTime() - from.getTime()) / 1000;
  return Math.max(0, Math.ceil(cooldownSeconds - elapsed));
}

export const reportThrottleService = {
  /**
   * Throws when a submission should be rejected. Operators bypass throttling
   * entirely — they are authoritative for their station and legitimately need
   * to correct a fast-moving forecourt.
   */
  async assertAllowed(subject: ThrottleSubject, now: Date = new Date()): Promise<void> {
    const [lastForStation, lastAnywhere] = await Promise.all([
      reportRepository.lastReportAtForUserStation(subject.userId, subject.stationId),
      reportRepository.lastReportAtForUser(subject.userId),
    ]);

    if (lastAnywhere) {
      const wait = secondsUntil(lastAnywhere, REPORT_LIMITS.globalCooldownSeconds, now);
      if (wait > 0) {
        throw AppError.reportCooldown(
          `Please wait ${wait}s before submitting another report`,
          wait,
        );
      }
    }

    if (lastForStation) {
      const wait = secondsUntil(lastForStation, REPORT_LIMITS.perStationCooldownSeconds, now);
      if (wait > 0) {
        throw AppError.reportCooldown(
          `You reported this station recently — please wait ${wait}s`,
          wait,
        );
      }
    }

    const hourAgo = new Date(now.getTime() - 60 * 60_000);

    const [stationCount, totalCount] = await Promise.all([
      reportRepository.countReportsSince(subject.userId, hourAgo, subject.stationId),
      reportRepository.countReportsSince(subject.userId, hourAgo),
    ]);

    if (stationCount >= REPORT_LIMITS.maxReportsPerStationPerHour) {
      throw AppError.reportCooldown(
        'You have reported this station too many times in the past hour',
      );
    }

    if (totalCount >= REPORT_LIMITS.maxReportsPerHour) {
      throw AppError.reportCooldown('You have submitted too many reports in the past hour');
    }

    // Checked last: an identical repeat is the least severe case, and saying so
    // specifically is more useful to an honest client than a generic cooldown.
    const duplicateSince = new Date(
      now.getTime() - REPORT_LIMITS.duplicateWindowSeconds * 1000,
    );

    const isDuplicate = await reportRepository.findDuplicate({
      userId: subject.userId,
      stationId: subject.stationId,
      since: duplicateSince,
      queueBucket: subject.queueBucket,
      availability: subject.availability,
      pressureValue: subject.pressureValue,
    });

    if (isDuplicate) {
      throw AppError.duplicateReport(
        'You already submitted an identical report for this station recently',
      );
    }
  },
};
