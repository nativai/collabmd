const WISDOM_RESULT_LIMIT = 50;
const TIMER_TICK_MS = 1_000;
const SOFTEN_COPY_AFTER_MS = 8_000;
const USUAL_SECONDS = 15;

/**
 * Format the escalating progress copy for the semantic (vec) wait.
 * Under ~8s: "Ranking by meaning… Ns · usually ~15s".
 * After ~8s the copy softens so the wait keeps reading as "working", not hung.
 */
export function formatProgressCopy(elapsedMs = 0) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (elapsedMs >= SOFTEN_COPY_AFTER_MS) {
    return `Still searching — semantic search can take ~${USUAL_SECONDS}s · ${seconds}s`;
  }
  return `Ranking by meaning… ${seconds}s · usually ~${USUAL_SECONDS}s`;
}

/**
 * Progressive submit-driven runner for Wisdom mode (FDE verdict §4).
 *
 * On run(): fire Call A (mode=lex, fast preview) AND Call B (mode=full, authoritative
 * vec+lex) in parallel. Render A as a provisional preview <1s; when B lands, REPLACE it.
 * `stop()` aborts B and keeps A as the final ("keyword matches only"). abort() cancels
 * both (query edit / mode switch / esc). Each has its own AbortController.
 */
export class QuickSwitcherWisdomSearchRunner {
  constructor({ resultLimit = WISDOM_RESULT_LIMIT } = {}) {
    this.resultLimit = resultLimit;
    this.lexController = null;
    this.fullController = null;
    this.timer = null;
    this.timerStartedAt = 0;
    this.token = 0;
    this.lastRunQuery = null;
  }

  isPending() {
    return Boolean(this.fullController);
  }

  abort({ invalidate = true } = {}) {
    this._stopTimer();
    if (invalidate) {
      this.token += 1;
      this.lastRunQuery = null;
    }
    this.lexController?.abort();
    this.lexController = null;
    this.fullController?.abort();
    this.fullController = null;
  }

  /** Stop only the authoritative vec call; keep whatever preview already rendered. */
  stop() {
    this._stopTimer();
    this.fullController?.abort();
    this.fullController = null;
  }

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run the progressive search. Callbacks:
   *  - onPreview(result, query)  — Call A landed (provisional)
   *  - onFinal(result, query)    — Call B landed (authoritative, replaces preview)
   *  - onProgress(copy, elapsed) — timer tick while B is in flight
   *  - onProgressEnd({ stopped }) — B settled or was stopped (hide progress affordance)
   *  - onUnavailable(message)    — engine unreachable / both calls failed
   *  - onEmpty(query)            — completed with zero hits
   */
  run({
    isActive = () => true,
    onEmpty,
    onFinal,
    onPreview,
    onProgress,
    onProgressEnd,
    onUnavailable,
    query = '',
    wisdomSearch,
  } = {}) {
    this.abort();
    if (!wisdomSearch) {
      onUnavailable?.('Wisdom search is unavailable right now.');
      return;
    }

    const token = this.token + 1;
    this.token = token;
    this.lastRunQuery = query;

    const lexController = new AbortController();
    const fullController = new AbortController();
    this.lexController = lexController;
    this.fullController = fullController;

    const isCurrent = () => isActive() && token === this.token;
    let previewRendered = false;
    let finalRendered = false;

    // Escalating progress timer (only meaningful while the vec call is pending).
    this.timerStartedAt = performance.now?.() ?? 0;
    this._startTimer(onProgress, isCurrent);

    // Call A — fast lex preview.
    Promise.resolve()
      .then(() => wisdomSearch({
        limit: this.resultLimit,
        mode: 'lex',
        query,
        signal: lexController.signal,
      }))
      .then((result) => {
        if (!isCurrent() || finalRendered) {
          return;
        }
        previewRendered = true;
        onPreview?.(result, query);
      })
      .catch(() => {
        // A failing lex preview is non-fatal — the authoritative call still runs.
      })
      .finally(() => {
        if (this.lexController === lexController) {
          this.lexController = null;
        }
      });

    // Call B — authoritative vec+lex.
    Promise.resolve()
      .then(() => wisdomSearch({
        limit: this.resultLimit,
        mode: 'full',
        query,
        signal: fullController.signal,
      }))
      .then((result) => {
        if (!isCurrent()) {
          return;
        }
        finalRendered = true;
        this._stopTimer();
        onProgressEnd?.({ stopped: false });
        if (!result?.files?.length) {
          onEmpty?.(query);
          return;
        }
        onFinal?.(result, query);
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || !isCurrent()) {
          return;
        }
        this._stopTimer();
        // If the fast preview already rendered, keep it as the final result (relabelled
        // "keyword matches only") rather than blanking the panel or hanging in "loading".
        onProgressEnd?.({ keptPreview: previewRendered, stopped: false });
        if (!previewRendered) {
          onUnavailable?.(error?.body?.error || 'Wisdom search is unavailable right now.');
        }
      })
      .finally(() => {
        if (this.fullController === fullController) {
          this.fullController = null;
        }
      });
  }

  _startTimer(onProgress, isCurrent) {
    this._stopTimer();
    if (!onProgress) {
      return;
    }
    const tick = () => {
      if (!isCurrent() || !this.fullController) {
        this._stopTimer();
        return;
      }
      const now = performance.now?.() ?? 0;
      const elapsed = now - this.timerStartedAt;
      onProgress(formatProgressCopy(elapsed), elapsed);
    };
    tick();
    this.timer = setInterval(tick, TIMER_TICK_MS);
  }
}
