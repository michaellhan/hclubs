import { mkdirSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { findRepoRoot, loadRootEnv } from "../src/env";

/**
 * Zero-install local Postgres for development: PGlite (Postgres compiled to WASM),
 * persisted under data/pglite, exposed over the Postgres wire protocol so the web app,
 * scripts and pipeline all connect with an ordinary DATABASE_URL.
 *
 * PGlite has a single session, so concurrent client connections must be multiplexed
 * safely. We run each connection's messages up to a Sync/Query as one atomic batch
 * (so extended-protocol Parse/Bind/Execute sequences never interleave), and while a
 * connection has a transaction open, no other connection runs. Development only —
 * use real Postgres (docker compose / Neon) for anything else.
 */
loadRootEnv();
const port = Number(process.env.PGLITE_PORT ?? 54320);
const dataDir = join(findRepoRoot(), "data", "pglite");
mkdirSync(dataDir, { recursive: true });
const db = await PGlite.create({ dataDir, extensions: { pg_trgm } });

// --- Global session lock with transaction stickiness --------------------------------------
let owner: number | null = null;
const waiters: { id: number; resume: () => void }[] = [];

async function acquire(id: number): Promise<void> {
  if (owner === null || owner === id) {
    owner = id;
    return;
  }
  await new Promise<void>((resume) => waiters.push({ id, resume }));
  owner = id;
}

function release(id: number): void {
  if (owner !== id || db.isInTransaction()) return; // keep the session while a transaction is open
  forceRelease(id);
}

function forceRelease(id: number): void {
  if (owner !== id) return;
  owner = null;
  const next = waiters.shift();
  if (next) {
    owner = next.id;
    next.resume();
  }
}

// --- Wire protocol framing ---------------------------------------------------------------------
const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
const BATCH_END = new Set(["S", "Q", "H"]); // Sync, simple Query, Flush (Flush keeps the lock)

let nextId = 0;

function handle(socket: Socket) {
  const id = ++nextId;
  let buffer = Buffer.alloc(0);
  let startedUp = false;
  let pending: Buffer[] = [];
  let chain: Promise<void> = Promise.resolve();

  /**
   * `completesCycle` is false for batches ending in Flush (H): clients such as postgres-js
   * send Parse/Describe/Flush, wait for the description, then Bind/Execute/Sync — the
   * session must stay ours until the Sync.
   */
  const run = (batch: Buffer, completesCycle = true) => {
    chain = chain
      .then(async () => {
        await acquire(id);
        try {
          await db.execProtocolRawStream(new Uint8Array(batch), {
            onRawData: (data) => {
              // Copy: `data` may be a view into PGlite's WASM memory, which is reused for
              // the next chunk. A queued (backpressured) write must not see it change —
              // that corrupted large responses under concurrent load.
              if (socket.writable) socket.write(Buffer.from(data));
            },
          });
        } finally {
          if (completesCycle) release(id);
        }
      })
      .catch((error: unknown) => {
        console.error(`[pglite] connection #${id}:`, error);
        socket.destroy();
      });
  };

  socket.setNoDelay(true);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (!startedUp) {
        if (buffer.length < 8) return;
        const len = buffer.readInt32BE(0);
        const code = buffer.readInt32BE(4);
        if (buffer.length < len) return;
        const msg = buffer.subarray(0, len);
        buffer = buffer.subarray(len);
        if (code === SSL_REQUEST || code === GSSENC_REQUEST) {
          socket.write("N");
          continue;
        }
        if (code === CANCEL_REQUEST) {
          socket.end();
          return;
        }
        startedUp = true;
        run(Buffer.from(msg));
        continue;
      }
      if (buffer.length < 5) return;
      const type = String.fromCharCode(buffer[0] ?? 0);
      const total = 1 + buffer.readInt32BE(1);
      if (buffer.length < total) return;
      const msg = buffer.subarray(0, total);
      buffer = buffer.subarray(total);
      if (type === "X") {
        socket.end(); // Terminate: close the client, never the shared session
        return;
      }
      pending.push(Buffer.from(msg));
      if (BATCH_END.has(type)) {
        run(Buffer.concat(pending), type !== "H");
        pending = [];
      }
    }
  });

  const cleanup = () => {
    chain = chain.then(async () => {
      if (owner === id) {
        if (db.isInTransaction()) await db.exec("ROLLBACK");
        forceRelease(id);
      } else {
        const i = waiters.findIndex((w) => w.id === id);
        if (i !== -1) waiters.splice(i, 1);
      }
    });
  };
  socket.on("close", cleanup);
  socket.on("error", () => socket.destroy());
}

const server = createServer(handle);
server.listen(port, "127.0.0.1", () => {
  console.log(`✔ PGlite dev server on postgres://postgres@127.0.0.1:${port}/postgres (data: ${dataDir})`);
  console.log("  Press Ctrl+C to stop.");
});

const shutdown = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
