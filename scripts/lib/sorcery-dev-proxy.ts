import type { Plugin } from "vite";
import { nodeSorceryClient } from "./sorcery-client.ts";

/** A shared throttle also protects upstream from direct calls to the dev proxy. */
export function sorceryDevProxy(): Plugin {
  return {
    name: "sorcery-throttled-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = /^(\/api\/(sorcery|decks|curiosa))(\/.*)$/.exec(req.url ?? "");
        if (!route) { next(); return; }
        const method = req.method ?? "GET";
        if (method === "OPTIONS") { res.writeHead(204).end(); return; }
        if (method !== "GET" && method !== "POST") { res.writeHead(405).end(); return; }
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once("close", abort);
        try {
          const cards = route[2] === "sorcery";
          const target = `${cards ? "https://api.sorcerytcg.com/api" : "https://sorcerytcg.com"}${route[3]}`;
          const chunks: Buffer[] = [];
          if (method === "POST") for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const headers: Record<string, string> = {
            accept: req.headers.accept ?? "application/json",
            "user-agent": "SorceryStacks/1.0",
          };
          if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
          if (!cards) { headers.origin = "https://sorcerytcg.com"; headers.referer = "https://sorcerytcg.com/"; }
          const response = await nodeSorceryClient.fetch(target, {
            method, headers, body: method === "POST" ? Buffer.concat(chunks).toString("utf8") : undefined,
          }, { signal: controller.signal, retry: false });
          res.statusCode = response.status;
          res.setHeader("Content-Type", response.headers.get("content-type") ?? "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Sorcery-Proxy-Throttle", "active");
          res.setHeader("X-Sorcery-Proxy-Min-Interval-Ms", "3000");
          for (const name of ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
            const value = response.headers.get(name);
            if (value !== null) res.setHeader(name, value);
          }
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          if (!controller.signal.aborted) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "SorceryTCG proxy unavailable" }));
          }
        } finally {
          res.removeListener("close", abort);
        }
      });
    },
  };
}
