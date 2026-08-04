export interface HolidayResponseDto {
  id: string;
  companyId: string;
  date: string; // YYYY-MM-DD
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkImportHolidaysResponseDto {
  inserted: number;
  skipped: number;
}
