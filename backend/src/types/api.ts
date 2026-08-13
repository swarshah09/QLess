import type { ErrorCodeValue } from '../errors/errorCodes';

/** Every successful response has this shape. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Every failed response has this shape. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCodeValue | string;
    message: string;
    details?: Array<{ field?: string; message: string }>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}
