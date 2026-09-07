// Bound the entire operation, including response bodies and transports that
// fail to observe cancellation. Abort still releases real network resources.
export async function withDeadline(operation, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('request_deadline_exceeded');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('request_deadline_exceeded'));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
