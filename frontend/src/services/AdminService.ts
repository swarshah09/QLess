import { apiRequest } from '@/lib/api/client';
import type { Availability } from '@/types';

// AdminService — platform administration.
//
// Every route requires the ADMIN role server-side; the backend returns 403 for
// anyone else, so no client-side gate is load-bearing.

export interface Paginated<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  role: 'USER' | 'STATION_OPERATOR' | 'ADMIN';
  active: boolean;
  createdAt: string;
}

export interface AdminStation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  active: boolean;
  numberOfDispensers: number;
}

export const AdminService = {
  // --- Users ---------------------------------------------------------------

  async listUsers(page = 1, limit = 20, role?: string): Promise<Paginated<AdminUser>> {
    return apiRequest<Paginated<AdminUser>>('/admin/users', {
      query: { page, limit, role },
    });
  },

  async setUserRole(userId: string, role: AdminUser['role']): Promise<void> {
    await apiRequest<unknown>(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: { role },
    });
  },

  async setUserActive(userId: string, active: boolean): Promise<void> {
    await apiRequest<unknown>(`/admin/users/${userId}/active`, {
      method: 'PATCH',
      body: { active },
    });
  },

  // --- Stations ------------------------------------------------------------

  async listStations(page = 1, limit = 20, search?: string): Promise<Paginated<AdminStation>> {
    return apiRequest<Paginated<AdminStation>>('/admin/stations', {
      query: { page, limit, search, includeInactive: 'true' },
    });
  },

  async createStation(input: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    numberOfDispensers?: number;
    pressureThresholdLow?: number | null;
    pressureThresholdNormal?: number | null;
  }): Promise<AdminStation> {
    const result = await apiRequest<{ station: AdminStation }>('/admin/stations', {
      method: 'POST',
      body: input,
    });
    return result.station;
  },

  async updateStation(
    stationId: string,
    input: Partial<{
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      numberOfDispensers: number;
      pressureThresholdLow: number | null;
      pressureThresholdNormal: number | null;
    }>,
  ): Promise<AdminStation> {
    const result = await apiRequest<{ station: AdminStation }>(
      `/admin/stations/${stationId}`,
      { method: 'PATCH', body: input },
    );
    return result.station;
  },

  /** Stations are enabled/disabled, never deleted. A reason is mandatory. */
  async setStationActive(
    stationId: string,
    active: boolean,
    reason: string,
  ): Promise<void> {
    await apiRequest<unknown>(`/admin/stations/${stationId}/active`, {
      method: 'PATCH',
      body: { active, reason },
    });
  },

  /** Manual status override. Audited with admin identity, reason and timestamp. */
  async overrideStatus(
    stationId: string,
    input: {
      availability?: Availability;
      queueMin?: number | null;
      queueMax?: number | null;
      pressureValue?: number | null;
      activeDispensers?: number;
      reason: string;
    },
  ): Promise<void> {
    await apiRequest<unknown>(`/admin/stations/${stationId}/override`, {
      method: 'POST',
      body: input,
    });
  },

  // --- Operator assignments -------------------------------------------------

  async listStationOperators(stationId: string) {
    return apiRequest<{ operators: unknown[] }>(
      `/admin/stations/${stationId}/operators`,
    );
  },

  async assignOperator(stationId: string, userId: string, role = 'STAFF'): Promise<void> {
    await apiRequest<unknown>(`/admin/stations/${stationId}/operators`, {
      method: 'POST',
      body: { userId, role },
    });
  },

  async revokeOperator(stationId: string, userId: string): Promise<void> {
    await apiRequest<unknown>(
      `/admin/stations/${stationId}/operators/${userId}`,
      { method: 'DELETE' },
    );
  },

  // --- Moderation and statistics -------------------------------------------

  async suspiciousReports(page = 1, limit = 20) {
    return apiRequest<{ reports: unknown[]; lowReputationReporters: unknown[] }>(
      '/admin/reports/suspicious',
      { query: { page, limit } },
    );
  },

  async reportStats(sinceHours = 24) {
    return apiRequest<Record<string, unknown>>('/admin/stats/reports', {
      query: { sinceHours },
    });
  },

  async notificationStats(sinceHours = 24) {
    return apiRequest<Record<string, unknown>>('/admin/stats/notifications', {
      query: { sinceHours },
    });
  },

  async platformSettings() {
    return apiRequest<Record<string, unknown>>('/admin/settings');
  },

  async auditLogs(page = 1, limit = 20, action?: string) {
    return apiRequest<Paginated<Record<string, unknown>>>('/admin/audit-logs', {
      query: { page, limit, action },
    });
  },
};
