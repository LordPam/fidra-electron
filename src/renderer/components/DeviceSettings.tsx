import type { DeviceDataInfo } from '../../shared/device-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface DeviceSettingsProps {
  info: DeviceDataInfo | null;
  busy: boolean;
  error: string | null;
  onReset: (action: 'reset' | 'uninstall') => void;
  onShowFiles: () => void;
  className?: string;
}

export function DeviceSettings({ info, busy, error, onReset, onShowFiles, className }: DeviceSettingsProps) {
  return <Card className={cn(className)}>
    <CardHeader><CardTitle>This device</CardTitle><CardDescription>Your financial files are kept when you reset or remove Fidra.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Reset clears saved sign-ins, preferences and cached files, then closes every Fidra window. It keeps your ledgers, attachments, backups and team membership.</p>
      {info && <details className="text-sm"><summary className="cursor-pointer">Financial files kept on this device</summary>
        <ul className="mt-2 space-y-1 break-all select-text">{info.accounts.map((item) => <li key={item.path}>{item.path}</li>)}<li>Attachments: {info.attachmentDirectory}</li></ul>
        <p className="mt-2 text-muted-foreground">Backups stay in the locations chosen in Backup &amp; Restore. Copies you saved elsewhere also stay in place.</p>
      </details>}
      <div className="flex gap-2"><Button variant="outline" onClick={onShowFiles}>Show financial files</Button><Button variant="outline" disabled={busy} onClick={() => onReset('reset')}>{busy ? 'Preparing…' : 'Reset this device'}</Button><Button variant="outline" disabled={busy} onClick={() => onReset('uninstall')}>Uninstall Fidra</Button></div>
      <p className="text-xs text-muted-foreground">Uninstall resets this device and removes the installed app. Dragging only the app to the Trash on macOS keeps its saved device settings.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
