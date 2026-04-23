import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Plus, ShieldCheck, UserMinus, ArrowUpDown } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { InvitePersonnelDialog } from '@/dialogs/InvitePersonnelDialog';

export function PersonnelPanel({ compact = false }: { compact?: boolean }) {
  const {
    personnel,
    currentPersonnel,
    isAdmin,
    loadPersonnel,
    removePersonnel,
    updatePersonnelRole,
  } = useAuthStore();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    loadPersonnel();
  }, [loadPersonnel]);

  const adminCount = personnel.filter((p) => p.role === 'admin').length;

  const handleRemove = async (id: string, name: string) => {
    setActionError(null);
    const result = await removePersonnel(id);
    if (!result.success) {
      setActionError(result.error ?? `Failed to remove ${name}.`);
    }
  };

  const handleToggleRole = async (id: string, currentRole: string) => {
    setActionError(null);
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const result = await updatePersonnelRole(id, newRole);
    if (!result.success) {
      setActionError(result.error ?? 'Failed to update role.');
    }
  };

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium">Personnel</h3>
            <p className="text-sm text-muted-foreground">Manage who can access the database.</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Invite
            </Button>
          )}
        </div>
      )}

      {compact && isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Invite
          </Button>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      <div className="rounded-md border border-border-subtle">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border-subtle bg-surface-raised">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span />
        </div>

        {/* Rows */}
        {personnel.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            No personnel yet. Invite members to get started.
          </div>
        ) : (
          personnel.map((p) => {
            const isSelf = p.id === currentPersonnel?.id;
            const isLastAdmin = p.role === 'admin' && adminCount === 1;

            return (
              <div
                key={p.id}
                className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-2 px-3 py-2 text-sm items-center border-b border-border-subtle last:border-b-0"
              >
                <span className="truncate">
                  {p.name}
                  {isSelf && <span className="text-muted-foreground ml-1">(you)</span>}
                </span>
                <span className="truncate text-muted-foreground">{p.email}</span>
                <span>
                  {p.role === 'admin' ? (
                    <Badge variant="default" className="text-xs">Admin</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Member</Badge>
                  )}
                </span>
                <span>
                  {p.isActive ? (
                    <Badge variant="outline" className="text-xs text-green-600">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-yellow-600">Invited</Badge>
                  )}
                </span>
                <span>
                  {isAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={isLastAdmin && p.role === 'admin'}
                          onClick={() => handleToggleRole(p.id, p.role)}
                        >
                          {p.role === 'admin' ? (
                            <>
                              <ArrowUpDown className="h-4 w-4 mr-2" />
                              Demote to Member
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              Promote to Admin
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={isLastAdmin && p.role === 'admin'}
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleRemove(p.id, p.name)}
                        >
                          <UserMinus className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      <InvitePersonnelDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
