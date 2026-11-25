// Reuse the existing session after a lost response: never create a second file.
// https://developers.google.com/workspace/drive/api/guides/manage-uploads
export async function transferResumable(
  file,
  send,
  queryStatus,
  { signal, delay = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let offset = 0,
    lastError;
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("Upload cancelado", "AbortError");
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    check();
    if (attempt) {
      await delay(400 * 2 ** (attempt - 1));
      check();
      try {
        const status = await queryStatus();
        check();
        if (status.ok) return status.json();
        if (status.status !== 308)
          throw Object.assign(
            new Error(
              `Não foi possível retomar o envio (HTTP ${status.status}). O original foi preservado.`,
            ),
            { status: status.status },
          );
        const range = status.headers.get("range")?.match(/bytes=0-(\d+)/);
        offset = range ? Number(range[1]) + 1 : 0;
        if (offset >= file.size)
          throw new Error(
            "O Drive ainda não confirmou o envio completo. Tente novamente.",
          );
      } catch (error) {
        if (
          error.name === "AbortError" ||
          (error.status >= 400 && error.status < 500 && error.status !== 429)
        )
          throw error;
        lastError = error;
        continue;
      }
    }
    try {
      return await send(offset);
    } catch (error) {
      if (
        error.name === "AbortError" ||
        (error.status >= 400 && error.status < 500 && error.status !== 429)
      )
        throw error;
      lastError = error;
    }
  }
  throw (
    lastError || new Error("Não foi possível retomar o envio. Tente novamente.")
  );
}
