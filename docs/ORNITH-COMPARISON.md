# BLACKFURY Ornith 1.5 R Claude Code benchmark audit

Date: 2026-08-24  
Claude menu label: `HERMES · Ornith 1.5 R Q6 · 256K`  
Actual Ollama model: `ornith-1.5-r-vision-256k:latest`  
Harness: Claude Code Desktop, local Anthropic gateway, `low` effort, bypass permissions  
Output project: `D:\unsloth test\TEST ORNITH`

## Verdict

Ornith did not complete the benchmark. It produced a partial backend and
frontend, but neither side is executable. It stopped twice before substantive
implementation, required two rescue prompts, then entered a repeated path
confusion loop after compaction. The run was stopped after it ignored an exact
path correction and continued probing misspelled directories.

This result is substantially below the Qwen3.8 run. The failure is not a
matter of polish or a few missed edge cases: the server cannot import, the
browser script cannot parse, the required tests and launcher do not exist, and
several Ollama API assumptions are observably wrong.

Indicative score: **1.7/10**.

| Dimension | Score | Evidence |
|---|---:|---|
| autonomy and persistence | 2/10 | stopped twice, needed rescue prompts, then looped on the project path |
| preservation/scope | 4/10 | existing models/configs survived, but it created a stray typo directory |
| architecture | 4/10 | attempted separated backend/frontend modules, but contracts disagree |
| functional coverage | 1/10 | files exist, but no executable application or working live controls |
| test quality | 0/10 | `tests` is empty; no claimed or runnable suite |
| final correctness | 0/10 | fatal Python import and JavaScript parse failures |
| efficiency | 1/10 | 11.6M cumulative tokens for an incomplete, non-running result |

## The model label was not the runtime quantization

The Claude selector advertised `Q6`, but `ollama show` and `/api/ps` reported:

| Runtime property | Actual value |
|---|---|
| architecture | `qwen35moe` |
| parameters | `35.5B` |
| quantization | `Q4_K_M` |
| context | `262144` |
| capabilities | completion, vision, tools, thinking |
| draft tokens | `1` |
| temperature | `0.7` |
| top-p / top-k | `0.95` / `20` |

The benchmark therefore measured the 256K vision-capable Q4 Ollama profile,
not an Ornith Q6 runtime. This configuration-label defect must be fixed before
claiming a Q6 comparison.

## Measured run

- wall time from benchmark prompt to controlled stop: **51:19**
- unique main-model turns: **85**
- internal subagent transcripts: **0**
- unique tool calls: **91** (`40` Bash, `21` Write, `17` Edit, `12` Read, `1` Glob)
- cumulative input tokens: **11,534,003**
- cumulative output tokens: **105,722**
- cumulative total: **11,639,725**
- automatic compactions: **2**
- rescue prompts after the benchmark prompt: **3**

The input count sums the full context charged on each model turn. Repeated
history is therefore counted repeatedly; it is not 11.5 million unique tokens.

## Independent checks

| Check | Result |
|---|---|
| Python AST parse | pass for the four backend files |
| backend import / app creation | **fail**: `NameError: _default_metrics is not defined` |
| JavaScript syntax | **fail** at `frontend/app.js:322` |
| automated tests | **fail**: empty `tests` directory |
| one-command launcher | **missing** |
| README / dependency manifest | **missing** |
| live application probe | impossible because the backend cannot import |
| browser preview | unstyled/offline and non-functional |

## Critical defects

### 1. Backend fails during module import

`AppState.metrics` uses `field(default_factory=_default_metrics)` before
`_default_metrics` has been defined. Importing `backend/app.py` raises a
`NameError`, so Uvicorn cannot start the application.

### 2. Frontend does not parse

The stop-button handler contains:

```js
stopGeneration | () => stopGeneration()
```

`node --check` reports `SyntaxError: Malformed arrow function parameter list`.
No frontend code runs after this parse failure.

### 3. Model discovery uses the wrong HTTP method

`llama_api.list_models()` sends `POST /api/tags`. Ollama 0.32.15 returns:

```text
GET /api/tags  -> 200
POST /api/tags -> 405 method not allowed
```

The model selector therefore cannot auto-discover models.

### 4. Model loading sends an invalid Anthropic request

The warm-up request posts `content`, `options`, and `keep_alive` directly to
`/v1/messages`. The exact payload was probed against the running server and
returned HTTP 400:

```text
max_tokens is required and must be positive
```

The code never supplies the required Anthropic `max_tokens` and `messages`
shape, so its load button cannot load the model.

### 5. Unload is a false success

The client calls `DELETE /v1/models/{name}`. Ollama returns 405, but the code
explicitly treats both 404 and 405 as a successful unload and clears its local
state. The model remains in VRAM while the UI claims it was unloaded.

### 6. Safe swap clears the newly loaded model

`_safe_swap()` warms the target, then calls `_unload_model()` for the previous
model. `_unload_model()` unconditionally clears the global current model,
loaded flag, model info, and metrics. Even if the upstream operations worked,
the final state would report no loaded model.

### 7. Browser and backend disagree on the chat protocol

The backend defaults `/api/chat` to SSE streaming. The browser calls
`response.json()` and has no SSE reader. A successful streaming response would
therefore fail JSON parsing instead of displaying live output.

### 8. Vision and reasoning controls are cosmetic

The file picker previews a local image but never encodes or sends it. Image
mode only prefixes text with `Analyze this image:`. The selected reasoning
level is included in the browser payload but ignored by the backend and Ollama
client.

## Additional defects

- `asyncio.Queue` is written from a worker thread without a thread-safe loop
  callback, and the generator calls nonexistent `queue.close()`.
- The JSONL parser never returns its remainder, so previously parsed bytes can
  be processed repeatedly as the buffer grows.
- synchronous `urllib.request` calls run inside async functions; wrapping them
  in `asyncio.timeout` does not stop the blocking operation.
- evaluation duration is converted from nanoseconds using `1e6` instead of
  `1e9`, making the generated-rate calculation approximately 1000x too small.
- the frontend references missing IDs `live-metrics` and `prompt-image`; the
  HTML defines `out-live-metrics` and `image-input` instead.
- the browser attaches duplicate request/error polling intervals.
- Stop changes an unrelated state field and never aborts the active request.
- non-stream generation drops the generated response text and returns counts
  only.
- load, unload, and swap endpoints can return `{ok: true}` after upstream
  failures.
- the root `/` route returns JSON while the UI is mounted only under `/static`.
- there is no MTP metric source that Ollama actually exposes, so the acceptance
  panel cannot meet the benchmark requirement.

## Agentic-behaviour findings

Positive observations:

- it preserved the existing model files and configurations;
- it automatically resumed across two compactions;
- it correctly rejected a fake `<system-reminder>` embedded in tool output;
- it attempted to inspect the real services instead of building a static mock.

Negative observations:

- the first response ended after exploration without implementing anything;
- the second response ended after creating three empty directories;
- it repeatedly rewrote already broken files instead of establishing a small
  running slice and tests;
- after compaction, `unsloth` drifted into `unslopt` and `unsloft`;
- it declared real files missing despite direct filesystem evidence;
- it created `D:\unslopt test\TEST ORNITH\frontend\app.js` outside the requested
  project and then deleted/recreated that typo directory;
- an exact correction to `D:\unsloth test\TEST ORNITH` did not stop the loop.

## Qwen3.8 versus Ornith 1.5 R

| Measure | Qwen3.8 Unsloth Q6 | Ornith 1.5 R advertised Q6 |
|---|---:|---:|
| actual runtime quant | Q6 GGUF | **Q4_K_M Ollama** |
| context profile | 200K text / 128K vision | 256K vision |
| wall time | 4:14:58 | 0:51:19 before controlled stop |
| cumulative tokens | 21,073,029 | 11,639,725 |
| tool calls | 241 | 91 |
| subagents | 4 | 0 |
| completed application | yes | no |
| own tests | 12 unit + 5 live | none |
| independent syntax/import | pass | fail / fail |
| independent live text | pass | impossible |
| independent vision | pass | impossible |
| indicative score | **6.8/10** | **1.7/10** |

The Qwen implementation still had serious post-audit defects, especially a
false-positive live test and stale model state. It nevertheless built and ran
a real application, executed tests, supported text and vision, and completed
the task. Ornith did not reach the minimum executable baseline in this run.

## Conclusion

This benchmark does **not** support the claim that Ornith 1.5 R is the stronger
Claude Code agent on BLACKFURY. It also does not yet compare Q6 against Q6,
because the selected Ornith entry resolved to Q4_K_M. Before rerunning Ornith,
fix the selector-to-runtime mapping, use a new empty folder, and keep the same
prompt and audit gates. Do not reuse or repair this candidate as benchmark
input.
