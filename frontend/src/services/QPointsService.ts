import { apiRequest } from '@/lib/api/client';
import { mapQPointsSummary, type ApiQPointsSummary } from '@/lib/api/mappers';
import type { QPointsSummary } from '@/types';

export const QPointsService = {
  /** Authenticated only — guests have no QPoints, per platform design. */
  async getMyTotal(): Promise<QPointsSummary> {
    const result = await apiRequest<{ qpoints: ApiQPointsSummary }>('/qpoints/me');
    return mapQPointsSummary(result.qpoints);
  },
};
