// PGlite dans un worker_thread : l'environnement du worker n'a pas jsdom, donc PGlite démarre quel que soit l'environnement du test
// (node ou jsdom). Protocole : { id, op: "boot" | "exec" | "query" | "close", sql, params } -> { id, ok, rows | error }.
import { parentPort } from "node:worker_threads";
import { PGlite } from "@electric-sql/pglite";

let db;
parentPort.on("message", async (m) => {
  try {
    if (m.op === "boot") { db = new PGlite(); await db.exec(m.sql); parentPort.postMessage({ id: m.id, ok: true }); return; }
    if (m.op === "exec") { await db.exec(m.sql); parentPort.postMessage({ id: m.id, ok: true }); return; }
    if (m.op === "query") { const r = await db.query(m.sql, m.params ?? []); parentPort.postMessage({ id: m.id, ok: true, rows: r.rows }); return; }
    if (m.op === "close") { await db.close(); parentPort.postMessage({ id: m.id, ok: true }); return; }
    throw new Error(`opération inconnue : ${m.op}`);
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: { message: String(e?.message ?? e), code: e?.code } });
  }
});
