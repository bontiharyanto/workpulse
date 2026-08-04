export interface GeofenceResponseDto {
  id: string;
  companyId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  shiftCount: number;
  createdAt: string;
  updatedAt: string;
}
