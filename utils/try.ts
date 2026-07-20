type TrySuccess<T> = [null, T];
type TryError = { message: string; stack?: string };
type TryFailure = [TryError, null];

export type TryResult<T> = Promise<TrySuccess<T> | TryFailure>;

export default async function $try<T>(fn: () => Promise<T> | T): TryResult<T> {
  try {
    const result = await fn();
    return [null, result];
  } catch (error) {
    return [normalizeError(error), null];
  }
}

const normalizeError = (error: unknown): TryError => {
  const e = error instanceof Error ? error : new Error(String(error));
  const { message, stack } = e;
  return { message, stack };
};
