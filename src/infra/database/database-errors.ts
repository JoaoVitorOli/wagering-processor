import {
  ConnectionException,
  DeadlockException,
  DriverException,
} from '@mikro-orm/core';

const LOCK_NOT_AVAILABLE = '55P03';

export function isTransientDatabaseError(error: unknown): boolean {
  return (
    error instanceof DeadlockException ||
    error instanceof ConnectionException ||
    (error instanceof DriverException && error.code === LOCK_NOT_AVAILABLE)
  );
}
