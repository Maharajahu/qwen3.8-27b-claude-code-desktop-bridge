# Architecture and protocol mapping

## Components

1. Claude Code emits Anthropic Messages requests.
2. The bridge validates the Claude-visible model and context budget.
3. It converts the request to OpenAI Chat Completions.
4. `llama-server` runs Qwen3.8 and streams OpenAI-style SSE chunks.
5. The bridge converts those chunks into Anthropic SSE events.

The bridge is deliberately stateless. Claude Code owns conversation state;
Qwen's preserved reasoning is carried inside assistant history.

## Request mapping

| Anthropic input | OpenAI-compatible upstream |
|---|---|
| `system` | leading `system` message |
| text content block | string or `text` part |
| image block | `image_url` data URL or URL |
| assistant `thinking` | `reasoning_content` |
| assistant `tool_use` | `tool_calls` |
| user `tool_result` | `tool` message |
| tool `input_schema` | function `parameters` |
| `output_config.effort` | Qwen `reasoning_effort` |
| disabled thinking | `chat_template_kwargs.enable_thinking=false` |

Qwen's official API example keeps earlier reasoning in both
`reasoning_content` and `reasoning`; carrying historical Claude `thinking`
blocks back as `reasoning_content` provides the same continuity.

## Response mapping

| Qwen/OpenAI stream | Anthropic stream |
|---|---|
| start | `message_start` |
| `delta.reasoning_content` | thinking block + `thinking_delta` |
| first text delta | close thinking; open text block |
| `delta.content` | `text_delta` |
| accumulated tool call | `tool_use` block + `input_json_delta` |
| finish reason | `message_delta.stop_reason` |
| end | `message_stop` |

A local opaque signature is attached when a thinking block closes. Claude Code
can return that block in the next request; this bridge treats it as local state
and does not attempt Anthropic signature verification.

## Streaming watchdog

Anthropic's gateway protocol says inference must stream and that Claude Code
can abort an Anthropic-base-URL stream after 300 seconds without bytes. The
bridge emits `ping` events every 15 seconds while an upstream response is open,
including long pauses before the first reasoning token.

## Model discovery

Claude Code requests `GET /v1/models?limit=1000` with a three-second timeout.
The bridge returns a `data` array containing `id` and `display_name`.

Discovery rules that matter:

- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` must be set for the CLI.
- an ID must contain `claude` or `anthropic`, case-insensitive;
- redirects fail discovery;
- results are cached in `%USERPROFILE%\.claude\cache\gateway-models.json`;
- disabling nonessential traffic also disables discovery refresh.

## Dynamic text and vision contexts

`models.json` can declare:

```json
{
  "context_window": 200000,
  "text_context_window": 200000,
  "vision_context_window": 131072
}
```

The bridge selects the effective budget by scanning all message and tool-result
blocks for images. This prevents Claude Code from sending a 190K text history
to a backend currently intended for 128K vision.

The bridge cannot resize an already allocated llama.cpp KV cache. A deployment
that genuinely switches between the two limits needs either:

- two separately managed backends; or
- an ownership-aware router that drains requests, stops the old server, starts
  the appropriate text/vision profile, then forwards the request.

## Security boundary

The default host is `127.0.0.1`. `QWEN_CLAUDE_TOKEN` enables a simple bearer or
`x-api-key` check. It is sufficient to prevent accidental local cross-talk; it
is not a complete public-service security layer.

