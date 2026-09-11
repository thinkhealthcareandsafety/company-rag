/**
 * Retrieval quality eval harness. Runs searchDocuments() against a golden
 * set of (query -> expected document/passage) pairs and reports Hit@k and
 * Mean Reciprocal Rank — the two numbers that actually tell you whether a
 * chunking/embedding/reranking change helped or hurt, instead of eyeballing
 * a handful of chat answers.
 *
 * This ships with a two-entry TEMPLATE golden set
 * (scripts/eval/retrieval-golden.json) — it exists to prove the harness
 * works, not to evaluate your real documents. Replace it with 20-30 real
 * questions against your own uploaded PDFs before trusting this report; a
 * template golden set can only ever validate the mechanism.
 *
 * Usage: npm run eval:retrieval [path/to/golden.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { searchDocuments } from "../src/lib/retrieval/vectorSearch";

interface GoldenCase {
  query: string;
  expectedFilename?: string;
  expectedTextContains?: string;
}

const TOP_K = 6;

function loadGoldenSet(path: string): GoldenCase[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as (GoldenCase & { _comment?: string })[];
  return raw.filter((c) => c.query && (c.expectedFilename || c.expectedTextContains));
}

function matches(result: { filename: string; content: string }, expected: GoldenCase): boolean {
  const filenameOk = !expected.expectedFilename || result.filename === expected.expectedFilename;
  const textOk = !expected.expectedTextContains || result.content.toLowerCase().includes(expected.expectedTextContains.toLowerCase());
  return filenameOk && textOk;
}

async function main() {
  const goldenPath = resolve(process.argv[2] ?? "scripts/eval/retrieval-golden.json");
  const cases = loadGoldenSet(goldenPath);

  if (cases.length === 0) {
    console.error(`No usable cases found in ${goldenPath}`);
    process.exit(1);
  }

  console.log(`Running ${cases.length} retrieval eval case(s) against top_k=${TOP_K}...\n`);

  let hits = 0;
  let reciprocalRankSum = 0;
  const rows: { query: string; hit: boolean; rank: number | null; latencyMs: number }[] = [];

  for (const c of cases) {
    const started = Date.now();
    const results = await searchDocuments(c.query, TOP_K);
    const latencyMs = Date.now() - started;

    const rank = results.findIndex((r) => matches(r, c));
    const hit = rank !== -1;

    if (hit) {
      hits++;
      reciprocalRankSum += 1 / (rank + 1);
    }

    rows.push({ query: c.query, hit, rank: hit ? rank + 1 : null, latencyMs });
  }

  const hitRate = hits / cases.length;
  const mrr = reciprocalRankSum / cases.length;
  const avgLatency = rows.reduce((sum, r) => sum + r.latencyMs, 0) / rows.length;

  for (const r of rows) {
    const status = r.hit ? `hit @ rank ${r.rank}` : "MISS";
    console.log(`  [${status.padEnd(14)}] ${r.latencyMs}ms  "${r.query}"`);
  }

  console.log(`\nHit@${TOP_K}: ${(hitRate * 100).toFixed(1)}%  (${hits}/${cases.length})`);
  console.log(`MRR:      ${mrr.toFixed(3)}`);
  console.log(`Avg latency: ${avgLatency.toFixed(0)}ms`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
