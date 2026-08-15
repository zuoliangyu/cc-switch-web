export interface SequentialBulkActionResult<T> {
  succeeded: T[];
  failed: Array<{ item: T; error: unknown }>;
}

export async function runSequentialBulkAction<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
): Promise<SequentialBulkActionResult<T>> {
  const result: SequentialBulkActionResult<T> = {
    succeeded: [],
    failed: [],
  };

  for (const item of items) {
    try {
      await action(item);
      result.succeeded.push(item);
    } catch (error) {
      result.failed.push({ item, error });
    }
  }

  return result;
}
