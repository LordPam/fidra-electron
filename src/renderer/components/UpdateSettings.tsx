import { useUpdateStore } from '@/stores/update-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface UpdateSettingsProps { className?: string }

export function UpdateSettings({ className }: UpdateSettingsProps) {
  const { status, actionError, check, download, openInstaller, setAutomatic, openReleasePage } = useUpdateStore();
  const busy = !status || ['checking', 'downloading', 'preparing'].includes(status.phase);
  const unavailable = status?.phase === 'unavailable';
  const label = status?.phase === 'checking' ? 'Checking for updates…'
    : status?.phase === 'downloading' ? `Downloading update… ${Math.round(status.progress)}%`
    : status?.installerReady ? `Version ${status.version} is ready`
    : status?.phase === 'up-to-date' ? 'You’re up to date'
    : status?.version ? `Version ${status.version} is available` : 'Check for the latest Fidra release';
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>Keep Fidra up to date. Your ledgers and Local Sync setup stay in place.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className="text-sm font-medium">{unavailable ? status.message : label}</p>
        {status?.phase === 'downloading' && <progress aria-label="Update download" className="h-2 w-full" max={100} value={status.progress} />}
        {status?.lastCheckedAt && <p className="text-xs text-muted-foreground">Last checked {new Date(status.lastCheckedAt).toLocaleString('en-GB')}</p>}
        {!!status?.releaseNotes.length && <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{status.releaseNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        {(actionError || status?.error) && <p role="alert" className="text-sm text-destructive">{actionError ?? status?.error}</p>}
        {status?.installerReady && <p className="text-xs text-muted-foreground">Fidra will finish saving in all windows, open the installer and quit. Complete the installation, then reopen Fidra.</p>}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox aria-label="Download updates automatically" checked={status?.automatic ?? true} disabled={!status || busy || unavailable} onCheckedChange={(value) => void setAutomatic(value === true)} />
          <span>Download updates automatically<span className="mt-1 block text-xs text-muted-foreground">Check quietly in the background. Installation always waits for you.</span></span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy || unavailable} onClick={() => void check()}>Check for updates</Button>
          {status?.installerReady && <Button size="sm" disabled={busy} onClick={() => void openInstaller()}>Open installer</Button>}
          {status?.version && !status.installerReady && <Button size="sm" disabled={busy} onClick={() => void download()}>Download update</Button>}
          <Button size="sm" variant="ghost" onClick={() => void openReleasePage()}>Official downloads</Button>
        </div>
      </CardContent>
    </Card>
  );
}
