import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const { signIn, startOAuth, loading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    const success = await signIn(email.trim(), password);
    if (success) {
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSignIn();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); clearError(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign In</DialogTitle>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="signin-email" className="text-sm">Email</Label>
            <Input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="you@example.com"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="signin-password" className="text-sm">Password</Label>
            <Input
              id="signin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Password"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSignIn}
            disabled={loading || !email.trim() || !password}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Sign In
          </Button>
        </div>

        {/* OAuth buttons hidden — providers not configured yet
        <Separator />

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground text-center">Or sign in with</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => startOAuth('google')}
              disabled={loading}
            >
              Google
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => startOAuth('azure')}
              disabled={loading}
            >
              Microsoft
            </Button>
          </div>
        </div>
        */}
      </DialogContent>
    </Dialog>
  );
}
