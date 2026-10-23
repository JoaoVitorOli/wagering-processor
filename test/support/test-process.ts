import type { Subprocess } from 'bun';

export interface AppProcess {
  url: string;
  process: Subprocess;
  exited: Promise<number>;
  stop(signal?: NodeJS.Signals): Promise<number>;
}

let nextPort = 4100 + Math.floor(Math.random() * 500);

export async function spawnApp(
  env: Record<string, string>,
): Promise<AppProcess> {
  const port = nextPort++;
  const child = Bun.spawn(['bun', 'src/main.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      PENDING_REFERENCE_WORKER_INTERVAL_MS: '200',
      OUTBOX_PUBLISHER_INTERVAL_MS: '200',
      ...env,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const url = `http://localhost:${port}`;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app exited during startup with ${child.exitCode}`);
    }
    try {
      await fetch(`${url}/wallets/00000000-0000-7000-8000-000000000000`);
      break;
    } catch {
      await Bun.sleep(100);
    }
  }

  return {
    url,
    process: child,
    exited: child.exited,
    async stop(signal = 'SIGTERM') {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
      return child.exited;
    },
  };
}
