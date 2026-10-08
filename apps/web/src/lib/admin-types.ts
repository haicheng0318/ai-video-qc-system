import { ApiUser } from './api';

export const roleLabels: Record<string, string> = {
  admin: '管理员', content_owner: '内容负责人', supervisor: '编导主管', director: '编导',
  operator: '运营', advertiser: '投放', visitor: '访客',
};

export type ManagedUser = ApiUser & {
  status: 'active' | 'disabled' | 'archived';
  createdById?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
};

export type UserListResponse = {
  items: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
};

export type RoleCapability = {
  role: string;
  capabilities: Record<string, boolean>;
};
