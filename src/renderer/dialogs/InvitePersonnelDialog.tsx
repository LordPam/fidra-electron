import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Copy, Check } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import type { PersonnelRole } from '../../shared/auth-types';

interface InvitePersonnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvitePersonnelDialog({ open, onOpenChange }: InvitePersonnelDialogProps) {
  const { invitePersonnel, localInviteMember, authMode } = useAuthStore();
  const isLocalSync = authMode === 'localSync';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PersonnelRole>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setName('');
    setEmail('');
    setRole('member');
    setError('');
    setInviteCode(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleInvite = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (isLocalSync) {
        const result = await localInviteMember(name.trim(), email.trim(), role);
        setSaving(false);
        if (!result.success) {
          setError(result.error ?? 'Invite failed.');
        } else {
          setInviteCode(result.inviteCode ?? null);
        }
      } else {
        await invitePersonnel(name.trim(), email.trim(), role);
        setSaving(false);
        handleClose();
      }
    } catch (e) {
      setSaving(false);
      const msg = String(e);
      if (msg.includes('invalid_format') || msg.includes('Invalid input') || msg.includes('invalid_email')) {
        setError('Please enter a valid email address.');
      } else {
        setError(msg.replace(/^Error:\s*Error invoking remote method '[^']*':\s*/, ''));
      }
    }
  };

  const handleCopy = async () => {
    if (inviteCode) {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite Personnel</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {inviteCode ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this invite code with <strong>{name}</strong>. They&apos;ll use it to join the shared database.
            </p>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <code className="flex-1 font-mono text-sm tracking-wider">{inviteCode}</code>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name" className="text-sm">Name</Label>
              <Input
                id="invite-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-email" className="text-sm">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Role</Label>
              <div className="flex gap-2">
                <Button
                  variant={role === 'member' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRole('member')}
                  className="flex-1"
                >
                  Member
                </Button>
                <Button
                  variant={role === 'admin' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRole('admin')}
                  className="flex-1"
                >
                  Admin
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {inviteCode ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Invite
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
