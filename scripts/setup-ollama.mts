#!/usr/bin/env node
/**
 * Ensures a lightweight local LLM is available for the Overlord.
 *
 * - Checks if Ollama is installed and running.
 * - Pulls a small model if none suitable is present (default llama3.2:3b).
 * - Starts the server if it is not already running.
 *
 * Run with: node --experimental-strip-types scripts/setup-ollama.mts
 * Or via npm run setup-llm
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

const MODEL = process.env.OVERLORD_MODEL || "qwen2.5-coder:7b";
const FALLBACKS = ["llama3.2:1b", "qwen2.5:1.5b", "phi3:mini", "gemma2:2b"];

function hasOllama(): boolean {
  try {
    execSync("ollama --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function isRunning(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function startServer() {
  console.log("Starting Ollama server in the background…");
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function ensureModel(model: string) {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags");
    const data = await r.json();
    const names: string[] = (data.models ?? []).map((m: any) => m.name);
    if (names.some((n) => n === model || n.startsWith(model.split(":")[0]!))) {
      console.log(`Model ${model} already present.`);
      return;
    }
  } catch {}

  console.log(`Pulling ${model} (this may take a minute the first time)…`);
  try {
    execSync(`ollama pull ${model}`, { stdio: "inherit" });
  } catch {
    console.warn(`Failed to pull ${model}. Trying fallbacks…`);
    for (const fb of FALLBACKS) {
      try {
        execSync(`ollama pull ${fb}`, { stdio: "inherit" });
        console.log(`Using fallback model ${fb}`);
        process.env.OVERLORD_MODEL = fb;
        return;
      } catch {}
    }
    console.error("Could not pull any lightweight model. Install one manually with `ollama pull llama3.2:3b`.");
  }
}

async function main() {
  if (!hasOllama()) {
    console.log(`
Ollama is not installed.
Install it from https://ollama.com/download
Then re-run this script.

On Linux/macOS: curl -fsSL https://ollama.com/install.sh | sh
On Windows:     irm https://ollama.com/install.ps1 | iex
`);
    process.exit(1);
  }

  if (!(await isRunning())) {
    startServer();
    // give it a moment
    await new Promise((r) => setTimeout(r, 2500));
  }

  if (await isRunning()) {
    console.log("Ollama server is up.");
    await ensureModel(MODEL);
    console.log("Overlord LLM is ready.");
  } else {
    console.error("Could not start Ollama. Start it manually with `ollama serve`.");
  }
}

main();
