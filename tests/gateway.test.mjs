import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import {
  createGatewayServer,
  estimateInputTokens,
  hasImageContent,
  toOpenAIRequest,
  translateReasoningEffort,
} from '../src/gateway.mjs'

const model = {
  id: 'local.anthropic.qwen3.8-27b',
  display_name: 'LOCAL · Qwen3.8 27B · 200K/128K',
  upstream_model: 'qwen3.8-27b-local',
  supports_vision: true,
  context_window: 200000,
  text_context_window: 200000,
  vision_context_window: 131072,
  max_output_tokens: 65536,
  reasoning_effort_mode: 'qwen-xhigh',
  sampling: {
    temperature: 1.0,
    top_p: 0.95,
    top_k: 20,
    min_p: 0.0,
    presence_penalty: 0.0,
    repeat_penalty: 1.0,
  },
}

const catalog = {
  schema_version: 1,
  upstream_base_url: 'http://127.0.0.1:1/v1',
  models: [model],
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  await new Promise(resolve => server.close(resolve))
}

async function jsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

test('request translation preserves tools, thinking, sampling, and vision', () => {
  const image = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
  }
  const payload = {
    model: model.id,
    system: 'You are a coding agent.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Inspect it.' }, image] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should read the file.', signature: 'opaque' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'README.md' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hello' }],
      },
    ],
    tools: [{
      name: 'Read',
      description: 'Read a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
    }],
    output_config: { effort: 'high' },
    max_tokens: 4096,
    stream: true,
  }

  const translated = toOpenAIRequest(payload, model)
  assert.equal(translated.hasImages, true)
  assert.equal(translated.contextWindow, 131072)
  assert.equal(translated.request.model, model.upstream_model)
  assert.equal(translated.request.reasoning_effort, 'xhigh')
  assert.equal(translated.request.temperature, 1.0)
  assert.equal(translated.request.messages[0].role, 'system')
  assert.equal(translated.request.messages[1].content[1].type, 'image_url')
  assert.equal(translated.request.messages[2].reasoning_content, 'I should read the file.')
  assert.equal(translated.request.messages[2].tool_calls[0].function.name, 'Read')
  assert.equal(translated.request.messages[3].role, 'tool')
  assert.equal(translated.request.tools[0].function.parameters.type, 'object')
  assert.equal(hasImageContent(payload.messages[0].content), true)
  assert.ok(estimateInputTokens(payload) > 1)
})

test('thinking off uses Qwen chat-template controls instead of invalid effort=off', () => {
  const translated = toOpenAIRequest({
    model: model.id,
    messages: [{ role: 'user', content: 'PONG' }],
    reasoning: { effort: 'none' },
  }, model)
  assert.equal(translated.request.reasoning_effort, undefined)
  assert.deepEqual(translated.request.chat_template_kwargs, {
    enable_thinking: false,
    preserve_thinking: true,
  })
  assert.equal(translateReasoningEffort('max', 'qwen-xhigh'), 'xhigh')
})

test('dynamic context rejects a vision prompt that only fits the text window', () => {
  const text = 'x'.repeat(400000)
  const textRequest = toOpenAIRequest({
    model: model.id,
    messages: [{ role: 'user', content: text }],
    max_tokens: 32,
  }, model)
  assert.equal(textRequest.contextWindow, 200000)

  assert.throws(() => toOpenAIRequest({
    model: model.id,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
        },
      ],
    }],
  }, model), /131072-token vision context/)
})

test('HTTP bridge supports discovery, auth, native thinking SSE, and tool calls', async () => {
  const seen = []
  const mock = http.createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const body = await jsonBody(request)
    seen.push(body)
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'check ' }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'PONG' }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2 } })}\n\n`)
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Read', arguments: '{"path":"README.md"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }))
  })
  const mockPort = await listen(mock)
  const gateway = createGatewayServer({
    catalog,
    upstreamBaseURL: `http://127.0.0.1:${mockPort}/v1`,
    token: 'test-token',
    logger: () => {},
  })
  const gatewayPort = await listen(gateway)
  const base = `http://127.0.0.1:${gatewayPort}`

  try {
    const unauthorized = await fetch(`${base}/v1/models`)
    assert.equal(unauthorized.status, 401)

    const headers = {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    }
    const models = await fetch(`${base}/v1/models?limit=1000`, { headers }).then(r => r.json())
    assert.equal(models.data[0].id, model.id)
    assert.equal(models.data[0].display_name, model.display_name)

    const stream = await fetch(`${base}/v1/messages?beta=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Reply PONG.' }],
        max_tokens: 32,
        stream: true,
        output_config: { effort: 'low' },
      }),
    }).then(r => r.text())
    assert.match(stream, /event: message_start/)
    assert.match(stream, /"type":"thinking_delta"/)
    assert.match(stream, /"type":"signature_delta"/)
    assert.match(stream, /PONG/)
    assert.match(stream, /event: message_stop/)

    const tools = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Read it.' }],
        tools: [{
          name: 'Read',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        }],
        max_tokens: 32,
        stream: false,
      }),
    }).then(r => r.json())
    assert.equal(tools.stop_reason, 'tool_use')
    assert.equal(tools.content[0].name, 'Read')
    assert.deepEqual(tools.content[0].input, { path: 'README.md' })
    assert.equal(seen.length, 2)
  } finally {
    await close(gateway)
    await close(mock)
  }
})

