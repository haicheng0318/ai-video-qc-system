import { UserRole } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  account: string;
  name: string;
  role: UserRole;
  managerId: string | null;
  department?: string | null;
  expiresAt?: Date | null;
  mustChangePassword?: boolean;
  sessionId?: string;
};
