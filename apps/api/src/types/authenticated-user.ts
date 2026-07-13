import { UserRole } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  account: string;
  name: string;
  role: UserRole;
  managerId: string | null;
};
