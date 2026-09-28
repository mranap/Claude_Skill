'use client';

import { roleCreateSchema, SYSTEM_ROLES } from '@adpilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, ShieldAlert, ShieldCheck, Trash, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorAlert } from '@/components/shared/error-alert';
import { Form, FormField, FormRootError, TextField } from '@/components/shared/form';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/api/query-keys';
import type { PermissionDto, RoleDto } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { pluralize } from '@/lib/utils/format';
import { rolesApi } from './api';
import { isPrivilegedRole, usePermissionCatalog, useRoles } from './hooks';

const GROUP_ORDER = ['Product', 'Administration', 'Users', 'Access control', 'System', 'Operations'];

function groupPermissions(catalog: PermissionDto[]): [string, PermissionDto[]][] {
  const map = new Map<string, PermissionDto[]>();
  for (const p of catalog) map.set(p.group, [...(map.get(p.group) ?? []), p]);
  return [...map.entries()].sort(
    ([a], [b]) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
}

export function RolesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAuth();
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [createOpen, setCreateOpen] = useState(false);
  const canManage = can('admin.roles.manage');

  const selectedId = searchParams.get('role') ?? roles.data?.[0]?.id;
  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  const select = (id: string) => router.replace(`${pathname}?role=${id}`, { scroll: false });

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Roles bundle permissions. Users get exactly one role; product data is always private to its owner."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Create role
            </Button>
          ) : null
        }
      />
      {roles.error || catalog.error ? (
        <ErrorAlert error={roles.error ?? catalog.error} onRetry={() => void (roles.refetch(), catalog.refetch())} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <div className="border-b px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {roles.data ? pluralize(roles.data.length, 'role') : 'Roles'}
            </div>
            <ul className="p-1.5" role="listbox" aria-label="Roles">
              {roles.isPending
                ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="m-1.5 h-12" />)
                : roles.data?.map((role) => (
                    <li key={role.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={role.id === selected?.id}
                        onClick={() => select(role.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors',
                          'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
                          role.id === selected?.id && 'bg-accent',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            isPrivilegedRole(role) ? 'bg-primary/10 text-primary-fg' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isPrivilegedRole(role) ? <ShieldCheck className="size-4" /> : <Users className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{role.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {pluralize(role.userCount, 'user')} · {role.key === SYSTEM_ROLES.SUPER_ADMIN ? 'all' : role.permissions.length} permissions
                          </span>
                        </span>
                        {role.isSystem ? (
                          <Badge variant="outline" size="sm" className="text-muted-foreground">
                            System
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
            </ul>
          </Card>
          {selected && catalog.data ? (
            <RoleEditor key={`${selected.id}:${selected.permissions.join(',')}:${selected.name}`} role={selected} catalog={catalog.data} canManage={canManage} />
          ) : (
            <Skeleton className="h-[32rem] rounded-lg" />
          )}
        </div>
      )}
      {createOpen ? (
        <CreateRoleDialog roles={roles.data ?? []} onClose={() => setCreateOpen(false)} onCreated={(role) => select(role.id)} />
      ) : null}
    </>
  );
}

const isAdminPermission = (key: string) => key.startsWith('admin.');

function RoleEditor({ role, catalog, canManage }: { role: RoleDto; catalog: PermissionDto[]; canManage: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { user: me, isSuperAdmin } = useAuth();
  const superAdmin = role.key === SYSTEM_ROLES.SUPER_ADMIN;
  // Only a Super Admin may grant admin.* permissions, edit roles that hold them, or edit their own role.
  const ownRole = role.key === me.role;
  const adminRole = role.permissions.some(isAdminPermission);
  const restriction = superAdmin || isSuperAdmin || !canManage
    ? null
    : ownRole
      ? 'You cannot change your own role. Ask a Super Admin.'
      : adminRole
        ? 'This role has administrative permissions, so only a Super Admin can change it.'
        : null;
  const readOnly = !canManage || !role.editable || superAdmin || !!restriction;
  const lockAdminPermissions = !isSuperAdmin;
  const [permissions, setPermissions] = useState<Set<string>>(() => new Set(role.permissions));
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const groups = useMemo(() => groupPermissions(catalog), [catalog]);

  const permsDirty =
    permissions.size !== role.permissions.length || role.permissions.some((p) => !permissions.has(p));
  const metaDirty = name.trim() !== role.name || (description.trim() || null) !== (role.description ?? null);
  const dirty = !readOnly && (permsDirty || metaDirty);
  const grantsAdmin = [...permissions].some((p) => p.startsWith('admin.'));

  const save = useMutation({
    mutationFn: () =>
      rolesApi.update(role.id, {
        ...(metaDirty ? { name: name.trim(), description: description.trim() || null } : {}),
        ...(permsDirty ? { permissions: [...permissions] } : {}),
      }),
    onSuccess: async () => {
      toast.success('Role saved', { description: 'Users with this role get the new permissions on their next request.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });

  const toggle = (key: string, on: boolean) =>
    setPermissions((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const toggleGroup = (items: PermissionDto[], on: boolean) =>
    setPermissions((prev) => {
      const next = new Set(prev);
      for (const p of items) {
        if (lockAdminPermissions && isAdminPermission(p.key)) continue;
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });

  const has = (key: string) => superAdmin || permissions.has(key);

  return (
    <Card>
      <CardHeader className="border-b pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {role.name}
              <Badge variant="outline" size="sm" className="font-mono">
                {role.key}
              </Badge>
              {role.isSystem ? <Badge variant="muted" size="sm">System role</Badge> : <Badge size="sm">Custom role</Badge>}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{pluralize(role.userCount, 'user')} assigned</p>
          </div>
          {!readOnly && !role.isSystem ? (
            <Button variant="destructive-outline" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash />
              Delete role
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {superAdmin ? (
          <Alert variant="info" icon={<Lock />}>
            <AlertTitle>Super Admin always has every permission</AlertTitle>
            <AlertDescription>This role cannot be edited or deleted. At least one active Super Admin must always exist.</AlertDescription>
          </Alert>
        ) : !canManage ? (
          <Alert icon={<Lock />}>
            <AlertDescription>You can view roles. Changing them requires the “Manage roles and permissions” permission.</AlertDescription>
          </Alert>
        ) : restriction ? (
          <Alert icon={<Lock />}>
            <AlertDescription>{restriction}</AlertDescription>
          </Alert>
        ) : !readOnly && lockAdminPermissions ? (
          <Alert variant="info" icon={<Lock />}>
            <AlertDescription>Administrative permissions (admin.*) can only be granted by a Super Admin, so they are locked here.</AlertDescription>
          </Alert>
        ) : null}

        {!superAdmin ? (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:max-w-sm">
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} maxLength={60} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={readOnly}
                maxLength={300}
                className="min-h-14"
                rows={2}
              />
            </div>
          </div>
        ) : null}

        {grantsAdmin && !superAdmin ? (
          <Alert variant="warning" icon={<ShieldAlert />}>
            <AlertDescription className="text-foreground/80">
              This role includes administrative permissions. Only a Super Admin can assign it to users.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5">
          {groups.map(([group, items]) => {
            const checked = items.filter((p) => has(p.key)).length;
            const all = checked === items.length;
            const editable = items.filter((p) => !(lockAdminPermissions && isAdminPermission(p.key)));
            return (
              <section key={group} className="rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b bg-surface-subtle px-4 py-2.5">
                  <label className="flex items-center gap-2.5 text-sm font-medium">
                    <Checkbox
                      checked={all ? true : checked ? 'indeterminate' : false}
                      onCheckedChange={(v) => toggleGroup(items, v === true)}
                      disabled={readOnly || editable.length === 0}
                      aria-label={`Toggle all ${group} permissions`}
                    />
                    {group}
                  </label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {checked}/{items.length}
                  </span>
                </div>
                <ul className="divide-y">
                  {items.map((p) => {
                    const locked = readOnly || (lockAdminPermissions && isAdminPermission(p.key));
                    return (
                      <li key={p.key}>
                        <label
                          className={cn('flex items-start gap-3 px-4 py-2.5 transition-colors', !locked && 'cursor-pointer hover:bg-muted/40')}
                          title={!readOnly && locked ? 'Only a Super Admin can grant administrative permissions' : undefined}
                        >
                          <Checkbox className="mt-0.5" checked={has(p.key)} onCheckedChange={(v) => toggle(p.key, v === true)} disabled={locked} />
                          <span className="min-w-0">
                            <span className="block text-sm">{p.description}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {p.key}
                              {!readOnly && locked ? ' · Super Admin only' : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {save.error ? <ErrorAlert error={save.error} /> : null}
      </CardContent>
      {!readOnly ? (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-lg border-t bg-card/95 px-5 py-3.5 backdrop-blur">
          <p className="text-xs text-muted-foreground">
            {dirty ? 'You have unsaved changes' : `${permissions.size} of ${catalog.length} permissions granted`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setPermissions(new Set(role.permissions));
                setName(role.name);
                setDescription(role.description ?? '');
              }}
            >
              Discard
            </Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || name.trim().length < 2} loading={save.isPending}>
              Save role
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the “${role.name}” role?`}
        description={
          role.userCount
            ? `${pluralize(role.userCount, 'user')} still ${role.userCount === 1 ? 'has' : 'have'} this role. Move them to another role first.`
            : 'The role is removed permanently. This cannot be undone.'
        }
        confirmText={role.key}
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          await rolesApi.remove(role.id);
          toast.success('Role deleted');
          router.replace(pathname, { scroll: false });
          await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles });
        }}
      />
    </Card>
  );
}

function toRoleKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'R_$1')
    .slice(0, 40);
}

function CreateRoleDialog({ roles, onClose, onCreated }: { roles: RoleDto[]; onClose: () => void; onCreated: (role: RoleDto) => void }) {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const [template, setTemplate] = useState<string>(roles.find((r) => r.key === SYSTEM_ROLES.USER)?.id ?? 'none');
  const [keyTouched, setKeyTouched] = useState(false);
  const form = useForm({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { key: '', name: '', description: '', permissions: [] as string[] },
  });

  const onSubmit = async (values: z.output<typeof roleCreateSchema>) => {
    const source = roles.find((r) => r.id === template);
    const created = await rolesApi.create({
      ...values,
      description: values.description || undefined,
      permissions: source && source.key !== SYSTEM_ROLES.SUPER_ADMIN ? source.permissions : [],
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles });
    toast.success('Role created', { description: 'Adjust its permissions, then assign it to users.' });
    onCreated(created);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <Form form={form} onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>Start from an existing role’s permissions and fine-tune them afterwards.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <FormRootError />
            <FormField
              control={form.control}
              name="name"
              label="Name"
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  placeholder="e.g. Media buyer (read-only)"
                  autoFocus
                  onChange={(e) => {
                    field.onChange(e);
                    if (!keyTouched) form.setValue('key', toRoleKey(e.target.value), { shouldValidate: form.formState.isSubmitted });
                  }}
                />
              )}
            />
            <FormField
              control={form.control}
              name="key"
              label="Key"
              description="Stable identifier: UPPER_CASE letters, digits and underscores."
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  className="font-mono uppercase"
                  onChange={(e) => {
                    setKeyTouched(true);
                    field.onChange(e.target.value.toUpperCase());
                  }}
                />
              )}
            />
            <TextField control={form.control} name="description" label="Description" placeholder="Optional" />
            <div className="grid gap-2">
              <Label>Start with permissions of</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No permissions</SelectItem>
                  {roles
                    .filter((r) => r.key !== SYSTEM_ROLES.SUPER_ADMIN)
                    .map((r) => {
                      const adminPerms = !isSuperAdmin && r.permissions.some(isAdminPermission);
                      return (
                        <SelectItem key={r.id} value={r.id} disabled={adminPerms} description={adminPerms ? 'Has admin permissions (Super Admin only)' : undefined}>
                          {r.name} ({r.permissions.length})
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Create role
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
