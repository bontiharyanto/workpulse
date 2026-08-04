export interface DepartmentResponseDto {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}
