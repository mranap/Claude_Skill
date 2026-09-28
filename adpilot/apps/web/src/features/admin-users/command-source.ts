import { UserRound } from 'lucide-react';
import type { CommandSource } from '@/components/layout/command-menu';
import { api } from '@/lib/api/client';
import type { AdminUserListItem, Paginated } from '@/lib/api/types';

/** Command-palette source: finds platform users by e-mail or name (admins with `admin.users.view`). */
export const adminUserCommandSource: CommandSource = {
  id: 'admin-users',
  heading: 'Users',
  minQueryLength: 2,
  search: async (query, signal) => {
    const res = await api.get<Paginated<AdminUserListItem>>('/admin/users', { q: query, pageSize: 6 }, { signal });
    return res.items.map((user) => ({
      id: `user:${user.id}`,
      label: user.name ? `${user.name} · ${user.email}` : user.email,
      group: 'Users',
      icon: UserRound,
      href: `/admin/users/${user.id}`,
      hint: user.role.name,
    }));
  },
};
