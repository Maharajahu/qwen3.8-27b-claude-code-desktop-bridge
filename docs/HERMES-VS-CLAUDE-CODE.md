# The same Qwen model in Hermes and Claude Code

The weights do not change when Qwen moves between Hermes and Claude Code. The
**harness** changes: system instructions, available tools, permission handling,
conversation compaction, task persistence and how tool results are returned to
the model.

This page gives reproducible examples for comparing both modes without
pretending that the local model becomes Claude simply because Claude Code is
the client.

## Two execution paths

```text
Hermes direct

User -> Hermes agent loop -> local OpenAI/Ollama endpoint -> Qwen3.8
                    \-> Hermes tools and memory

Claude Code

User -> Claude Code harness -> Anthropic bridge -> local OpenAI endpoint -> Qwen3.8
                \-> tools, permissions, agents, compaction and task state
```

The bridge in this repository is used only in the second path. Hermes can talk
to the same underlying `llama-server` or model router directly through its
normal local-provider configuration.

## Behavioural differences to expect

| Capability | Hermes direct | Through Claude Code |
|---|---|---|
| model weights | identical | identical |
| sampling/profile | selected by the local runtime | selected by the local runtime and bridge mapping |
| system instructions | Hermes prompt and memories | Claude Code project/harness prompt |
| tools | Hermes tool catalogue | Claude Code tools and MCP tools |
| permissions | Hermes approval mode | Claude Code accept/bypass workflow |
| subagents | Hermes implementation-dependent | Claude Code agent/task system when exposed |
| compaction | Hermes session policy | Claude Code context accounting and compaction |
| code editing loop | driven by Hermes | driven by Claude Code |
| visible reasoning | depends on Hermes rendering | bridge maps Qwen `reasoning_content` to thinking events |
| session lifecycle | Hermes owns the session | Claude Code owns the session; the bridge owns only protocol translation |

Claude Code can make the model look more persistent because it supplies a
stronger coding loop. It can also make a local model wander longer: more tools,
larger prompts and automatic continuation do not guarantee better judgment.

## Example 1: a small repository repair

Use a disposable repository containing failing tests. Give both harnesses the
same task and do not add technical hints after the first prompt.

```text
The project tests are failing. Find the cause, repair it with the smallest
correct change, run the full relevant test suite, and inspect your own diff.
Do not claim success unless the tests pass. Do not modify unrelated files.
```

### Run it in Hermes

1. Start the local Qwen profile normally.
2. Select that exact model in Hermes.
3. Open the disposable repository as the working directory.
4. Use Hermes' normal code tools and approval setting.
5. Send the prompt once and record:
   - files read and changed;
   - number of user interventions;
   - tests actually executed;
   - elapsed time and generated tokens;
   - whether the final claim matches an independent rerun.

Typical direct behaviour is a shorter, single-agent loop. That is useful for
focused fixes, but the result depends on which shell, edit and test tools the
Hermes build exposes.

### Run it in Claude Code

Start the bridge and Claude Code as described in the main README, select the
Qwen model, open a fresh copy of the same repository, then send the prompt
unchanged.

Observe the additional harness behaviour:

```text
inspect -> plan -> tool calls -> edits -> tests -> self-review -> final answer
                         \-> optional agents and automatic compaction
```

Do not score the run from the final prose. Rerun the tests independently and
inspect the diff after Claude Code says it is finished.

## Example 2: the BLACKFURY long-agent benchmark

The exact prompt is stored in
[`benchmarks/CONTROL-CENTER-PROMPT.md`](../benchmarks/CONTROL-CENTER-PROMPT.md).
It asks the model to inspect real local-AI services and build a complete model
control centre in an isolated folder.

The measured Qwen3.8 Claude Code run:

- lasted **4:14:58**;
- used **154** main-model turns, **4** subagent transcripts and **241** tools;
- survived compaction and produced a running text-and-vision application;
- passed its own 12 unit and 5 live tests;
- still contained high-impact defects found by the independent audit.

This is the clearest illustration of what the Claude Code harness adds: long
task persistence and orchestration. It is also evidence that a confident,
fully tested final answer is not sufficient proof of correctness.

See the full findings in
[`docs/BLACKFURY-QWEN-AUDIT.md`](BLACKFURY-QWEN-AUDIT.md).

## Example 3: compare plain model output with harnessed execution

The script below sends a minimal request directly to `llama-server`. It does
not use Hermes or Claude Code, so it provides a useful raw-model baseline.

```powershell
$body = @{
  model = 'qwen3.8-27b-local'
  messages = @(
    @{ role = 'user'; content = 'Inspect this Python function and identify the bug: def expired(now, ttl): return now >= now + ttl' }
  )
  temperature = 1.0
  top_p = 0.95
  max_tokens = 512
  stream = $false
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:8093/v1/chat/completions' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

Run the same request in Hermes, then ask Claude Code to repair the function in
a real repository with tests. The raw call measures answer quality; Hermes
measures its agent loop; Claude Code measures a different, more elaborate agent
loop.

## Fair-comparison checklist

Keep these identical between runs:

- exact model weights and quantization;
- context size, KV-cache type and GPU residency;
- temperature, top-p, top-k, min-p and penalties;
- reasoning effort;
- destination repository snapshot;
- initial prompt and acceptance criteria;
- allowed tools and permission mode where possible;
- maximum output/time budget.

Always report separately:

1. model generation speed;
2. wall-clock task time;
3. cumulative context tokens;
4. number of tool calls and interventions;
5. independent correctness results.

This prevents a stronger harness from being mistaken for stronger weights, or
a faster model from being mistaken for a better coding agent.
