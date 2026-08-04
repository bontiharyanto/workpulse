import type { EmploymentStatus } from './update-user.dto';
import type { UserRole } from '../../common/types/user-role';


export interface AdminUserDto {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  role: UserRole;
  employmentStatus: EmploymentStatus;
  departmentId: string | null;
  departmentName: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  hiredAt: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}

export interface UserCredentialResponseDto {
  user: AdminUserDto;
  temporaryPassword: string;
}
