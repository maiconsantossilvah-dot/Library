export async function runLimitedQueue(items, worker, limit = 3) {
  const pending = [...items];
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (pending.length) {
      const item = pending.shift();
      await worker(item);
    }
  });

  await Promise.all(workers);
}
