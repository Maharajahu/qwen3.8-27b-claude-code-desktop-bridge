# Qwen3.8-27B RTX 5090 Claude Code Desktop benchmark audit

Date: 2026-08-24  
Candidate: Qwen3.8-27B Unsloth UD Q6_K_XL  
Harness: Claude Code Desktop, local Anthropic gateway, `low` effort  
Runtime profile: 200K text / 128K vision, Q4 KV, MTP x3  
Output project: `D:\unsloth test\TEST CLAUDE`

## Verdict

The model completed a real multi-hour coding job and produced a useful,
functional application. It was autonomous, preserved unrelated files, used
parallel exploration, repaired defects, ran browser checks and survived a
manual compaction boundary.

It did **not** reach the quality of its final claim. The independent audit
found high-impact state and test defects that its own adversarial pass missed.
This is a strong local coding agent, but this run is not evidence of consistent
Opus-level correctness.

Indicative score: **6.8/10**.

| Dimension | Score | Evidence |
|---|---:|---|
| autonomy and persistence | 9/10 | worked for 4h+, spawned explorers, resumed after compact |
| preservation/scope | 9/10 | isolated folder; unrelated parent files left alone |
| architecture | 8/10 | separated FastAPI backend and static frontend |
| functional coverage | 7/10 | live metrics, text, vision, controls and logs exist |
| test quality | 5/10 | tests pass, but critical live assertions are vacuous/stateful |
| final correctness | 6/10 | several user-visible state/metric defects remain |
| efficiency | 3/10 | very high repeated-context cost and long wandering investigation |

## Measured run

- wall time from benchmark prompt to final answer: **4:14:58**
- main-model turns: **154**
- internal subagent transcripts: **4**
- tool uses: **241**
- cumulative input tokens: **20,938,440**
- cumulative output tokens: **134,589**
- cumulative total: **21,073,029**

The input total is the sum of per-turn context accounting, so repeated history
is counted again on every turn. It is not 20.9 million unique words of work.

## Independent checks that passed

- Python backend unit suite: **12/12**
- live suite as written: **5/5**
- JavaScript syntax: pass
- Python AST parse: pass
- exact-model text probe at low effort and 128 max tokens: final `PONG`
- generated red-square image probe: final `Red`
- all four local services reported healthy in the dashboard
- Qwen reasoning streamed separately from final text

## Defects found after completion

### High — stale selected-model state

`app/static/app.js` stores the initial dropdown value in `S.model`. Changing the
dropdown or completing a model swap never updates that state. Chat requests use
`S.model` before the actual select value, and the 30-second model refresh uses
the same stale value.

Observed in the browser:

1. select a different model without loading it;
2. wait for the model-catalog poll;
3. the dropdown resets to the old Qwen entry.

Impact: after a user chooses or swaps a model, the test chat can target the
previous model and the UI can visually undo the selection.

### High — live chat test is a false positive

`tests/test_live.py::test_chat_streams` sends model `active` and asserts only:

- HTTP 200;
- SSE content type;
- the body contains `data:`.

The backend intentionally represents an upstream failure as an SSE error frame
inside HTTP 200. The independent probe returned:

```text
Unknown model 'active'
```

The test still passes. It should reject error frames and assert final `PONG`
plus `[DONE]`.

### High — live test changes router ownership

`test_select_noop_is_safe` deliberately reassigns the active model owner to
the benchmark controller. Before the test the owner was `claude-desktop`;
afterward it was the benchmark controller.

Impact: closing Claude can fail to unload the model because the lifecycle
supervisor no longer owns it. A live test must save and restore owner/state.

### Medium — displayed stream tok/s is chunk rate

The frontend increments `tokens` once for each SSE `delta.content`, regardless
of how many model tokens or characters are in the chunk. The displayed value
is stream-chunks per second, not generation tokens per second.

Use authoritative llama.cpp timing/metrics or tokenizer counts instead.

### Medium — UI mode disagrees with active backend

The live backend was in `vision` mode while the Prompt Test panel initialized
itself as `text`. The frontend always calls `setMode("text")` at startup and
does not synchronize it to the loaded backend.

Impact: users can accidentally request a mode swap or misunderstand the active
context limit.

### Medium — proxied SSE frames are not fully standard

The backend removes upstream blank separators, writes every `data:` line with a
single newline, and adds one blank line only at the end. The custom browser
parser accepts newline-delimited chunks, but a normal `EventSource` consumer
expects each SSE event to end with a blank line.

### Low — model groups are never attached

The frontend creates `optgroup` elements, but appends each option directly to
the select and never appends the groups. Browser count: 33 options, zero
optgroups.

### Low — “Recent Errors” badges count warnings

The badge counter includes warnings while the active tab can say “no recent
errors.” This makes gateway/router health look worse than the displayed log.

### Low — deprecated FastAPI lifecycle API

The backend uses `@app.on_event`, producing four deprecation warnings. It is
not a current functional failure but should move to a lifespan context.

## What Qwen did well

- It found the actual router control endpoints rather than inventing new
  process-kill behavior.
- It treated model loading as asynchronous and kept the browser UI responsive.
- It separated native reasoning from final response content.
- It fixed two legitimate late-review issues: authoritative MTP drafted-token
  accounting and waiting for a killed `nvidia-smi` subprocess.
- It was unusually cautious about deleting only a test log it created.
- It completed after compaction and retained the implementation plan.

## Benchmark rule for the Ornith comparison

Use the prompt in `benchmarks/CONTROL-CENTER-PROMPT.md`, a new empty directory,
the same Claude harness, bypass mode, low effort and the largest fully-GPU
context supported by that Ornith profile. Do not expose this Qwen project to
the candidate. Audit Ornith with the same independent checks and compare
completed requirements, defect severity, wall time and cumulative tokens.

