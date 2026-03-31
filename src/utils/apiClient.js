async function fetchJSON(url, options = {}) {
  const { retries = 2, timeoutMs = 15000, signal: externalSignal } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // If externally aborted (client disconnected), bail immediately — don't retry
    if (externalSignal?.aborted) {
      throw new Error('Request aborted: client disconnected');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Link external signal so aborting the parent also aborts this fetch
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort);
    }

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`API ${response.status}: ${response.statusText} - ${body.slice(0, 200)}`);
      }

      return await response.json();
    } catch (err) {
      // If externally aborted, throw immediately — no retries
      if (externalSignal?.aborted) {
        throw new Error('Request aborted: client disconnected');
      }
      if (attempt === retries) throw err;
      console.warn(`[apiClient] Retry ${attempt + 1} for ${url.split('?')[0]}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}

module.exports = { fetchJSON };
