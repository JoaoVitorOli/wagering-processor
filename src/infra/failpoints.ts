const enabled = new Set(
  (process.env.FAILPOINTS ?? '').split(',').filter(Boolean),
);

export function failpoint(name: string): void {
  if (enabled.has(name)) {
    process.kill(process.pid, 'SIGKILL');
  }
}
