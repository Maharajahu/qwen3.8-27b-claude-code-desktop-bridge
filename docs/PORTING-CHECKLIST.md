# Complete Qwen3.8 to Claude Code porting checklist

## Model artifacts

- [ ] Choose one Qwen3.8 GGUF quantization.
- [ ] Obtain the matching vision `mmproj`; do not mix projectors from another
      base model or conversion.
- [ ] Confirm the model reports MTP/NextN heads before enabling `draft-mtp`.
- [ ] Record the exact model repository, revision and license.
- [ ] Hash the GGUF and projector for reproducibility.

## Runtime validation

- [ ] Use a llama.cpp build that explicitly recognizes the architecture.
- [ ] Start text-only once and call `/health` and `/v1/models`.
- [ ] Send a 128-token text request and confirm final text, not only HTTP 200.
- [ ] Start with `mmproj` and send a generated red-square image.
- [ ] Verify the answer is `red`; this catches a silently ignored projector.
- [ ] Confirm model layers, KV cache and compute buffers remain in GPU VRAM.
- [ ] Check shared/system RAM rather than assuming `-ngl all` means zero spill.

## Context profiles

- [ ] Select text and vision contexts from measured VRAM, not model maximum.
- [ ] Quantize both K and V cache when needed.
- [ ] Reserve output and protocol overhead below the hard context limit.
- [ ] Run a near-limit prefill test.
- [ ] Verify compaction starts before the backend rejects the next turn.

## Qwen behavior

- [ ] Use official thinking defaults: temp 1.0, top-p 0.95, top-k 20.
- [ ] Map Claude low → Qwen low.
- [ ] Map Claude medium → Qwen medium.
- [ ] Map Claude high/max → Qwen xhigh.
- [ ] Disable thinking through the chat-template flag, not
      `reasoning_effort=off`.
- [ ] Return `reasoning_content` as a native Anthropic thinking block.
- [ ] Feed historical thinking back to Qwen for multi-turn continuity.

## Anthropic gateway contract

- [ ] Implement `/v1/messages`.
- [ ] Implement streaming SSE; do not buffer the full result.
- [ ] Implement `/v1/messages/count_tokens` or document the fallback.
- [ ] Implement `/v1/models?limit=1000`.
- [ ] Use a discovery ID containing `claude` or `anthropic`.
- [ ] Emit pings during long silent upstream gaps.
- [ ] Preserve text, images, tool schemas, tool calls and tool results.
- [ ] Abort upstream generation when the client disconnects.
- [ ] Return a real non-2xx error when inference fails.

## Harness validation

- [ ] Confirm `/status` shows the local gateway.
- [ ] Confirm `/model` shows the intended display name.
- [ ] Run a small read/edit/test coding task.
- [ ] Run a tool loop with at least two tools.
- [ ] Run a screenshot or image tool result through the vision path.
- [ ] Run past one compaction boundary and resume automatically.
- [ ] Close the client and verify the chosen lifecycle policy unloads the model.
- [ ] Test model swap ownership; a test must restore the original owner.

## Benchmark integrity

- [ ] Save the exact prompt.
- [ ] Use a fresh isolated working directory per model.
- [ ] Keep harness, permissions, tools, effort and context identical.
- [ ] Count final task success, not only generated tokens.
- [ ] Record wall time, cumulative input/output, tool calls and retries.
- [ ] Run independent tests after the model declares completion.
- [ ] Audit the tests for vacuous assertions and state-changing side effects.

