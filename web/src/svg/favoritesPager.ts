export interface PagerInput {
  totalCount: number;
  containerWidth: number;
  chipWidth: number;
  page: number;
}

export interface PagerResult {
  pageSize: number;
  totalPages: number;
  page: number;
  start: number;
  end: number;
}

export function computePager(i: PagerInput): PagerResult {
  const safeChip = Math.max(1, i.chipWidth);
  const fit = Math.floor(i.containerWidth / safeChip);
  const pageSize = Math.max(1, fit);
  const totalPages = Math.ceil(i.totalCount / pageSize);
  const clampedPage = Math.max(0, Math.min(i.page, Math.max(0, totalPages - 1)));
  const start = clampedPage * pageSize;
  const end = Math.min(i.totalCount, start + pageSize);
  return { pageSize, totalPages, page: clampedPage, start, end };
}
