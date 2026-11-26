// Run Claude Code headless with an explicit machine contract: tools, dirs, timeout, output. ([book claude-code p7] RULE 4)
import path from 'node:path';
import { childEnv, findClaude, run } from './util.mjs';

/**
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.cwd
 * @param {string[]} o.tools         built-in tools that exist at all in this run
 * @param {string[]} [o.allow]       permission rules that run without asking (e.g. "Bash(motlab stills:*)")
 * @param {string[]} [o.addDirs]
 * @param {object}   [o.schema]      JSON schema -> structured output
 * @param {string}   [o.systemAppend]
 * @param {string}   [o.model]
 * @param {number}   [o.timeoutMin]
 * @param {string}   [o.label]
 */
export async function claude(o) {
  const bin = findClaude();
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--tools', o.tools.join(','),
    '--permission-mode', o.tools.some(t => t === 'Write' || t === 'Edit') ? 'acceptEdits' : 'default',
    // No user/project hooks, plugins' MCP servers or settings from this machine leak into the run.
    '--setting-sources', 'project,local', '--strict-mcp-config',
    '--no-session-persistence'];
  if (o.allow?.length) args.push('--allowedTools', ...o.allow);
  for (const d of o.addDirs ?? []) args.push('--add-dir', d);
  if (o.schema) args.push('--json-schema', JSON.stringify(o.schema));
  if (o.systemAppend) args.push('--append-system-prompt', o.systemAppend);
  if (o.model) args.push('--model', o.model);

  const label = o.label ?? 'claude';
  let result = null, turns = 0;
  const started = Date.now();
  const r = await run(bin, args, {
    cwd: o.cwd, env: childEnv(), input: o.prompt, timeoutMs: (o.timeoutMin ?? 20) * 60_000,
    onStdoutLine: line => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant') {
        for (const c of ev.message?.content ?? []) {
          if (c.type === 'tool_use') { turns++; console.log(`   ${label} · ${c.name} ${describe(c.name, c.input, o.cwd)}`); }
        }
      } else if (ev.type === 'result') result = ev;
    },
  });
  const secs = Math.round((Date.now() - started) / 1000);
  if (!result) throw new Error(`${label}: no result (exit ${r.code}). ${r.stderr.trim().slice(-600)}`);
  if (result.is_error || result.subtype !== 'success') throw new Error(`${label}: ${result.subtype}: ${String(result.result ?? '').slice(0, 600)}`);
  console.log(`   ${label} done in ${secs}s, ${turns} tool calls${result.total_cost_usd ? ` (usage-equivalent $${result.total_cost_usd.toFixed(2)})` : ''}`);

  let data = null;
  if (o.schema) {
    data = result.structured_output ?? tryJson(result.result);
    if (!data) throw new Error(`${label}: expected JSON matching the schema, got: ${String(result.result).slice(0, 400)}`);
  }
  return { text: result.result, data, secs };
}

function tryJson(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  try { return JSON.parse(m ? m[1] : s); } catch { return null; }
}

function describe(name, input = {}, cwd) {
  const rel = p => (p ? path.relative(cwd, p).replaceAll('\\', '/') || '.' : '');
  if (input.file_path) return rel(input.file_path);
  if (input.pattern) return `"${input.pattern}"${input.path ? ' in ' + rel(input.path) : ''}`;
  if (input.command) return input.command.slice(0, 90);
  return '';
}
