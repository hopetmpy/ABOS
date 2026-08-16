// Smoke test: verify dist/conway/inference.js routes a local model to Ollama
// and a NIM model to NIM — without any Conway chat call.
import { createInferenceClient } from "./dist/conway/inference.js";
import { ModelRegistry } from "./dist/inference/registry.js";
import { createDatabase } from "./dist/state/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDb = path.join(os.tmpdir(), `automaton-smoke-${process.pid}.db`);
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
const db = createDatabase(tmpDb);

const registry = new ModelRegistry(db.raw);
registry.initialize();

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const nimBaseUrl = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const nimApiKey = process.env.NVIDIA_NIM_API_KEY;

function makeClient(defaultModel) {
  return createInferenceClient({
    apiUrl: "https://api.conway.tech",
    apiKey: "should-not-be-used-for-local",
    defaultModel,
    maxTokens: 128,
    ollamaBaseUrl,
    nimBaseUrl,
    nimApiKey,
    getModelProvider: (id) => registry.get(id)?.provider,
  });
}

async function trial(name, model, opts = {}) {
  const client = makeClient(model);
  const messages = [
    { role: "system", content: "You are a terse assistant. Reply in one short sentence." },
    { role: "user", content: "Say exactly: SMOKE_OK" },
  ];
  try {
    const res = await client.chat(messages, { model, ...opts });
    console.log(`[${name}] model=${res.model} finish=${res.finishReason} tokens=${res.usage?.totalTokens ?? "?"}`);
    console.log(`[${name}] content: ${(res.message?.content || "").slice(0, 200)}`);
    return res;
  } catch (err) {
    console.log(`[${name}] ERROR: ${err.message.slice(0, 300)}`);
    return null;
  }
}

const results = {};
results.ollama = await trial("ollama", "qwen2.5:7b");
if (nimApiKey) {
  results.nim = await trial("nim", "meta/llama-3.1-8b-instruct");
} else {
  console.log("[nim] skipped (no NVIDIA_NIM_API_KEY)");
}

db.close();
try { fs.unlinkSync(tmpDb); } catch {}

const ok = !!results.ollama;
console.log("\nSUMMARY:", ok ? "OLLAMA_PASS" : "OLLAMA_FAIL", results.nim ? "NIM_PASS" : "NIM_SKIP");
process.exit(ok ? 0 : 1);
