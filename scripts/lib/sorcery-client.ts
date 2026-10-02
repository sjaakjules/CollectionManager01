import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSorceryClient, emptySorceryRateState, sorcerySleep,
  type SorceryRateState, type WithSorceryRateState,
} from "../../src/data/sorceryRequest.ts";

const RATE_DIRECTORY = join(tmpdir(), `sorcery-stacks-requests-${process.getuid?.() ?? "local"}`);

/** One lock and durable budget for CLI commands and dev servers on this host. */
export function filesystemSorceryRateState(directory = RATE_DIRECTORY): WithSorceryRateState {
  return async (work, signal) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, "active.lock");
    const statePath = join(directory, "state.json");
    let missingOwner = false;
    for (;;) {
      signal?.throwIfAborted();
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Never steal a lock based on age: Retry-After may require a long wait.
        let owner = "";
        try { owner = await readFile(join(lock, "pid"), "utf8"); }
        catch (readError) { if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError; }
        if (owner === "" && !missingOwner) {
          missingOwner = true; // Allow the lock creator to finish writing its PID.
        } else if (!/^\d+$/.test(owner)) {
          throw new Error(`SorceryTCG limiter lock is incomplete at ${lock}; no request sent`);
        } else {
          try { process.kill(Number(owner), 0); }
          catch (pidError) {
            if ((pidError as NodeJS.ErrnoException).code === "ESRCH") {
              throw new Error(`SorceryTCG limiter has a stale lock at ${lock}. No request sent. Verify that the owner process has stopped before removing this lock; retain state.json.`);
            }
            throw pidError;
          }
        }
        await sorcerySleep(1000, signal);
      }
    }

    try {
      await writeFile(join(lock, "pid"), String(process.pid), { mode: 0o600 });
      let state: SorceryRateState = emptySorceryRateState();
      try {
        const saved: unknown = JSON.parse(await readFile(statePath, "utf8"));
        if (!saved || typeof saved !== "object" || !("nextAllowedAtMs" in saved)
          || !("blockedUntilMs" in saved) || !("reason" in saved)
          || typeof saved.nextAllowedAtMs !== "number" || !Number.isFinite(saved.nextAllowedAtMs)
          || typeof saved.blockedUntilMs !== "number" || !Number.isFinite(saved.blockedUntilMs)
          || typeof saved.reason !== "string") throw new Error("SorceryTCG limiter state is invalid; no request sent");
        state = { nextAllowedAtMs: saved.nextAllowedAtMs, blockedUntilMs: saved.blockedUntilMs, reason: saved.reason };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const persist = async () => {
        const temporary = join(lock, "next-state.json");
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, statePath);
      };
      return await work(state, persist);
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  };
}

export const nodeSorceryClient = createSorceryClient({ withRateState: filesystemSorceryRateState() });
