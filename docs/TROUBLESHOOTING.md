# Troubleshooting

## `image input is not supported ... provide the mmproj`

The language GGUF is loaded without its multimodal projector. Restart
`llama-server` with `--mmproj` pointing to the matching projector. Loading the
projector consumes additional VRAM; lower the vision context if necessary.

## `Estimated input ... exceeds 131072-token context`

An image anywhere in the request selects `vision_context_window`. Compact the
conversation, remove old image/tool-result blocks, or restart with a larger
vision profile that still fits entirely in GPU memory.

Do not advertise 200K to Claude while the backend was started at 128K. The UI
will compact too late and the backend will reject the request first.

## Model missing from `/model`

Check all of these:

1. `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` is present.
2. `/v1/models?limit=1000` answers in under three seconds without a redirect.
3. the model ID contains `claude` or `anthropic`.
4. no `CLAUDE_CODE_USE_*` provider variable is overriding the route.
5. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is not blocking discovery.
6. inspect `%USERPROFILE%\.claude\cache\gateway-models.json` and the
   `[gatewayDiscovery]` debug lines.

## Claude Desktop ignores CLI environment variables

Expected behavior. Desktop uses Developer → Configure Third-Party Inference.
The CLI uses `ANTHROPIC_BASE_URL` and its credential variables.

## Retry loop with no answer

Check the gateway and upstream logs for the first error. Common causes:

- model alias in `models.json` differs from `llama-server --alias`;
- the server returned HTTP 200 with an SSE error payload;
- thinking was sent as the unsupported string `off`;
- a beta body field was forwarded to an upstream schema that cannot parse it;
- the gateway stopped emitting bytes for more than the client watchdog limit;
- tool JSON was incomplete or malformed.

A live test must fail when it sees an SSE `error` object. Asserting only that
the body contains `data:` produces a false pass.

## Thinking runs but is invisible

Confirm the upstream sends `delta.reasoning_content`. The bridge must open an
Anthropic `thinking` content block and stream `thinking_delta`, then send a
`signature_delta` before closing it. Putting reasoning into ordinary text does
not give Claude Code its native thinking UI.

## Low effort still writes a long internal essay

`low` changes Qwen's reasoning policy; it is not a hard token budget. The
official model card warns that low effort can produce more retries and longer
total completion time on agentic work. Use a realistic `max_tokens`, compact
early, and compare completed-task time rather than per-turn verbosity alone.

## `Unknown model 'active'`

`active` is not an OpenAI model alias unless your router implements it. Send
the exact upstream model alias. Test code that sends `active` and only checks
for an SSE frame can pass even though inference returned an error.

## Final response is empty after a tiny `max_tokens`

Qwen may spend the entire allowance on reasoning and stop with
`finish_reason=length` before emitting final text. Allocate enough output or
disable thinking through `chat_template_kwargs.enable_thinking=false` for a
strict one-word probe.

## Claude closes but VRAM stays allocated

The bridge is stateless and does not own the inference process. Use the
foreground launcher and close it, or add a lifecycle supervisor/router with:

- an explicit owner ID;
- idle request draining;
- verified process/PID ownership;
- unload on the client quit event;
- a timeout fallback.

Never kill whatever happens to own a port without verifying its identity.

## MTP is slower than plain decode

Benchmark `n=0`, `n=1`, `n=2`, `n=3`, and `n=4` with the same prompt and
generation length. Track:

- accepted draft tokens / total drafted tokens;
- mean accepted length;
- target-only decode tok/s;
- speculative decode tok/s;
- VRAM and power.

The best draft count depends on model, quantization, prompt shape, sampler and
GPU. Acceptance below 100% is normal: the target model verifies every draft
and rejects branches it would not have sampled itself.

