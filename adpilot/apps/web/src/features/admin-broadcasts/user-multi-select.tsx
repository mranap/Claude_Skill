'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { adminUsersApi } from '@/features/admin-users/api';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils/cn';

export interface PickedUser {
  id: string;
  email: string;
  name: string | null;
}

/** Searchable multi-select of platform users (remote search on `GET /api/admin/users?q=`). */
export function UserMultiSelect({
  value,
  onChange,
  id,
  invalid,
}: {
  value: PickedUser[];
  onChange: (users: PickedUser[]) => void;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useQuery({
    queryKey: queryKeys.admin.users.search(debounced),
    queryFn: ({ signal }) =>
      adminUsersApi.list({ q: debounced, pageSize: 20, status: 'ACTIVE', sort: 'email:asc' }, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const selectedIds = new Set(value.map((u) => u.id));

  const toggle = (user: PickedUser) =>
    onChange(selectedIds.has(user.id) ? value.filter((u) => u.id !== user.id) : [...value, user]);

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-field px-3 text-left text-sm outline-none',
              'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 aria-invalid:border-destructive/70',
            )}
          >
            <span className={value.length ? 'text-foreground' : 'text-muted-foreground'}>
              {value.length
                ? `${value.length} user${value.length === 1 ? '' : 's'} selected`
                : 'Search users by e-mail or name…'}
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Type to search…" value={query} onValueChange={setQuery} />
            <CommandList>
              {results.isFetching && !results.data ? <CommandLoading>Searching…</CommandLoading> : null}
              {results.data && !results.data.items.length ? (
                <CommandEmpty>No active users found</CommandEmpty>
              ) : null}
              {results.data?.items.length ? (
                <CommandGroup heading={debounced ? 'Results' : 'Active users'}>
                  {results.data.items.map((u) => (
                    <CommandItem
                      key={u.id}
                      value={u.id}
                      onSelect={() => toggle({ id: u.id, email: u.email, name: u.name })}
                    >
                      <UserAvatar name={u.name} email={u.email} seed={u.id} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{u.name || u.email}</span>
                        {u.name ? (
                          <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                        ) : null}
                      </span>
                      <Check
                        className={cn(
                          'size-4 text-primary-fg',
                          selectedIds.has(u.id) ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((u) => (
            <Badge key={u.id} variant="secondary" className="h-6 gap-1 pr-0.5">
              {u.email}
              <button
                type="button"
                onClick={() => toggle(u)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Remove ${u.email}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
