interface MakerArtifacts {
  platform: string;
  arch: string;
  artifacts: string[];
}

/** Forge returns a result per maker, so a macOS ZIP and DMG are separate rows.
 * Sign one actual installer for each platform/architecture, never the ZIP row. */
export function releaseInstallers<T extends MakerArtifacts>(results: T[]): { result: T; artifact: string }[] {
  const groups = new Map<string, T[]>();
  for (const result of results) {
    if (!['darwin', 'win32'].includes(result.platform)) continue;
    const key = `${result.platform}/${result.arch}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.entries()].map(([target, rows]) => {
    const suffix = rows[0].platform === 'darwin' ? '.dmg' : '.exe';
    const candidates = rows.flatMap((result) => result.artifacts.filter((file) => file.endsWith(suffix)).map((artifact) => ({ result, artifact })));
    if (candidates.length !== 1) throw new Error(`Release requires one installer for ${target}; found ${candidates.length}.`);
    return candidates[0];
  });
}
