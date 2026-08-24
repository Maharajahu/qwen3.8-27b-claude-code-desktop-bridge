#!/usr/bin/env node

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MAX_BODY_BYTES = 256 * 1024 * 1024

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function stringifyContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return JSON.stringify(value)
  return value.map(block => {
    if (typeof block === 'string') return block
    if (block?.type === 'text') return block.text ?? ''
    if (block?.type === 'thinking') return block.thinking ?? ''
    if (block?.type === 'tool_result') return stringifyContent(block.content)
    return ''
  }).filter(Boolean).join('\n')
}

function imageBlock(block) {
  const source = block?.source
  if (!source) return null
  if (source.type === 'base64' && source.data) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${source.media_type ?? 'image/jpeg'};base64,${source.data}`,
      },
    }
  }
  if (source.type === 'url' && source.url) {
    return { type: 'image_url', image_url: { url: source.url } }
  }
  return null
}

function openAIContentParts(value) {
  const parts = []
  for (const block of asArray(value)) {
    if (typeof block === 'string') {
      parts.push({ type: 'text', text: block })
    } else if (block?.type === 'text') {
      parts.push({ type: 'text', text: block.text ?? '' })
    } else if (block?.type === 'image') {
      const image = imageBlock(block)
      if (image) parts.push(image)
    } else if (block?.type === 'tool_result') {
      parts.push(...openAIContentParts(block.content))
    }
  }
  return parts
}

function compactOpenAIContent(parts) {
  if (parts.length === 0) return ''
  if (parts.every(part => part.type === 'text')) {
    return parts.map(part => part.text).join('\n')
  }
  return parts
}

export function hasImageContent(value) {
  if (Array.isArray(value)) return value.some(hasImageContent)
  if (!value || typeof value !== 'object') return false
  if (value.type === 'image') return imageBlock(value) !== null
  if (value.type === 'tool_result') return hasImageContent(value.content)
  return false
}

function countImages(value) {
  if (Array.isArray(value)) {
    return value.reduce((count, entry) => count + countImages(entry), 0)
  }
  if (!value || typeof value !== 'object') return 0
  if (value.type === 'image' && imageBlock(value)) return 1
  if (value.type === 'tool_result') return countImages(value.content)
  return 0
}

function flushUserMessage(output, parts) {
  if (parts.length === 0) return
  output.push({ role: 'user', content: compactOpenAIContent([...parts]) })
  parts.length = 0
}

export function translateMessages(inputMessages = []) {
  const output = []
  for (const message of inputMessages) {
    if (message?.role === 'system' || message?.role === 'developer') {
      const content = stringifyContent(message.content)
      if (content) output.push({ role: message.role, content })
      continue
    }

    if (typeof message?.content === 'string') {
      output.push({ role: message.role, content: message.content })
      continue
    }

    const blocks = asArray(message?.content)
    if (message?.role === 'assistant') {
      const text = []
      const thinking = []
      const toolCalls = []
      for (const block of blocks) {
        if (block?.type === 'text') text.push(block.text ?? '')
        if (block?.type === 'thinking') thinking.push(block.thinking ?? '')
        if (block?.type === 'tool_use') {
          toolCalls.push({
            id: block.id ?? `call_local_${randomUUID().replaceAll('-', '')}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }
      const translated = { role: 'assistant', content: text.join('\n') || null }
      if (thinking.length > 0) translated.reasoning_content = thinking.join('\n')
      if (toolCalls.length > 0) translated.tool_calls = toolCalls
      output.push(translated)
      continue
    }

    const userParts = []
    for (const block of blocks) {
      if (block?.type === 'tool_result') {
        flushUserMessage(output, userParts)
        const resultParts = openAIContentParts(block.content)
        if (block.is_error) resultParts.unshift({ type: 'text', text: '[tool_error]' })
        output.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: compactOpenAIContent(resultParts),
        })
      } else if (block?.type === 'text') {
        userParts.push({ type: 'text', text: block.text ?? '' })
      } else if (block?.type === 'image') {
        const image = imageBlock(block)
        if (image) userParts.push(image)
      }
    }
    flushUserMessage(output, userParts)
  }
  return output
}

function translateToolChoice(choice) {
  if (!choice || choice.type === 'auto') return 'auto'
  if (choice.type === 'any') return 'required'
  if (choice.type === 'none') return 'none'
  if (choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } }
  }
  return 'auto'
}

export function translateReasoningEffort(effort, mode = 'qwen-xhigh') {
  if (typeof effort !== 'string') return null
  const normalized = effort.toLowerCase()
  if (normalized === 'none') return 'none'
  if (normalized === 'low') return 'low'
  if (normalized === 'medium') return 'medium'
  if (['high', 'xhigh', 'max'].includes(normalized)) {
    return mode === 'qwen-xhigh' ? 'xhigh' : 'high'
  }
  return null
}

export function estimateInputTokens(payload) {
  const estimationView = value => {
    if (Array.isArray(value)) return value.map(estimationView)
    if (!value || typeof value !== 'object') return value
    if (value.type === 'image') return { type: 'image' }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, estimationView(entry)]),
    )
  }
  const imageCount = (payload.messages ?? []).reduce(
    (count, message) => count + countImages(message?.content),
    0,
  )
  const material = JSON.stringify({
    system: estimationView(payload.system ?? ''),
    messages: estimationView(payload.messages ?? []),
    tools: estimationView(payload.tools ?? []),
  })
  return Math.max(
    1,
    Math.ceil(Buffer.byteLength(material, 'utf8') / 3) + 16 + imageCount * 4096,
  )
}

function applySampling(request, sampling = {}) {
  for (const key of [
    'temperature',
    'top_p',
    'top_k',
    'min_p',
    'presence_penalty',
    'repeat_penalty',
  ]) {
    if (sampling[key] != null) request[key] = sampling[key]
  }
}

export function toOpenAIRequest(payload, model) {
  const translatedMessages = translateMessages(payload.messages)
  const systemParts = []
  const primarySystem = stringifyContent(payload.system)
  if (primarySystem) systemParts.push(primarySystem)
  const messages = []

  for (const message of translatedMessages) {
    if (message.role === 'system' || message.role === 'developer') {
      const content = stringifyContent(message.content)
      if (content) systemParts.push(content)
    } else {
      messages.push(message)
    }
  }
  if (systemParts.length > 0) {
    messages.unshift({ role: 'system', content: systemParts.join('\n\n') })
  }

  const hasImages = (payload.messages ?? []).some(message =>
    hasImageContent(message?.content),
  )
  if (hasImages && !model.supports_vision) {
    throw new RangeError(`${model.display_name} is configured as text-only`)
  }

  const contextWindow = hasImages
    ? (model.vision_context_window ?? model.context_window)
    : (model.text_context_window ?? model.context_window)
  const inputTokens = estimateInputTokens(payload)
  const reserve = Number(model.context_reserve_tokens ?? 512)
  const availableOutput = contextWindow - inputTokens - reserve
  if (availableOutput < 1) {
    throw new RangeError(
      `Estimated input (${inputTokens} tokens) exceeds the ${contextWindow}-token ` +
      `${hasImages ? 'vision' : 'text'} context for ${model.display_name}`,
    )
  }

  const request = {
    model: model.upstream_model,
    messages,
    stream: Boolean(payload.stream),
    max_tokens: Math.max(
      1,
      Math.min(
        Number(payload.max_tokens) || model.max_output_tokens,
        model.max_output_tokens,
        availableOutput,
      ),
    ),
  }
  applySampling(request, model.sampling)

  const requestedEffort =
    payload.output_config?.effort ?? payload.reasoning?.effort ?? null
  const effort = translateReasoningEffort(
    requestedEffort,
    model.reasoning_effort_mode,
  )
  const thinkingDisabled = payload.thinking?.type === 'disabled' || effort === 'none'
  if (thinkingDisabled) {
    request.chat_template_kwargs = {
      enable_thinking: false,
      preserve_thinking: true,
    }
  } else if (effort) {
    request.reasoning_effort = effort
  }

  if (request.stream) request.stream_options = { include_usage: true }
  if (Array.isArray(payload.stop_sequences) && payload.stop_sequences.length > 0) {
    request.stop = payload.stop_sequences
  }
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    request.tools = payload.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }))
    request.tool_choice = translateToolChoice(payload.tool_choice)
    request.parallel_tool_calls = !payload.tool_choice?.disable_parallel_tool_use
  }

  return { request, inputTokens, hasImages, contextWindow }
}

function parseToolInput(value) {
  if (value == null || value === '') return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : { value: parsed }
  } catch {
    return { _raw: String(value) }
  }
}

function finishReason(reason, hasTools) {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

function messageId() {
  return `msg_local_${randomUUID().replaceAll('-', '')}`
}

export function fromOpenAIResponse(upstream, requestedModel, inputTokens) {
  const choice = upstream.choices?.[0] ?? {}
  const message = choice.message ?? {}
  const content = []
  const reasoning = message.reasoning_content ?? message.reasoning ?? ''
  const text = message.content ?? ''
  const toolCalls = message.tool_calls ?? []

  if (reasoning) {
    content.push({ type: 'thinking', thinking: reasoning, signature: 'local-qwen' })
  }
  if (text) content.push({ type: 'text', text })
  for (const call of toolCalls) {
    content.push({
      type: 'tool_use',
      id: call.id ?? `toolu_local_${randomUUID().replaceAll('-', '')}`,
      name: call.function?.name ?? 'unknown_tool',
      input: parseToolInput(call.function?.arguments),
    })
  }

  return {
    id: messageId(),
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: finishReason(choice.finish_reason, toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: upstream.usage?.prompt_tokens ?? inputTokens,
      output_tokens:
        upstream.usage?.completion_tokens ??
        Math.max(1, Math.ceil(Buffer.byteLength(text + reasoning, 'utf8') / 3)),
    },
  }
}

function writeJson(response, status, value, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  response.end(body)
}

function anthropicError(response, status, message, type = 'api_error') {
  writeJson(response, status, { type: 'error', error: { type, message } })
}

function readBody(request, maxBodyBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(new Error(`Request body exceeds ${maxBodyBytes} bytes`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => resolveBody(Buffer.concat(chunks)))
    request.once('error', reject)
  })
}

function sse(response, event, data) {
  if (response.destroyed || response.writableEnded) return false
  return response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function streamOpenAIAsAnthropic(
  upstream,
  response,
  requestedModel,
  inputTokens,
  log,
) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
  })

  const id = messageId()
  sse(response, 'message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  })

  const pingTimer = setInterval(() => {
    sse(response, 'ping', { type: 'ping' })
  }, 15000)
  pingTimer.unref?.()

  const decoder = new TextDecoder()
  const reader = upstream.body.getReader()
  let buffered = ''
  let textOpen = false
  let thinkingOpen = false
  let blockIndex = 0
  let textBytes = 0
  let reasoningBytes = 0
  let finalReason = null
  let usage = null
  const toolCalls = new Map()

  const closeThinking = () => {
    if (!thinkingOpen) return
    sse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'signature_delta', signature: 'local-qwen' },
    })
    sse(response, 'content_block_stop', {
      type: 'content_block_stop',
      index: blockIndex,
    })
    thinkingOpen = false
    blockIndex += 1
  }

  const closeText = () => {
    if (!textOpen) return
    sse(response, 'content_block_stop', {
      type: 'content_block_stop',
      index: blockIndex,
    })
    textOpen = false
    blockIndex += 1
  }

  const openThinking = () => {
    if (thinkingOpen) return
    closeText()
    thinkingOpen = true
    sse(response, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    })
  }

  const openText = () => {
    if (textOpen) return
    closeThinking()
    textOpen = true
    sse(response, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    })
  }

  const consumeChunk = chunk => {
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}

    if (delta.reasoning_content || delta.reasoning) {
      const reasoning = delta.reasoning_content ?? delta.reasoning
      openThinking()
      reasoningBytes += Buffer.byteLength(reasoning, 'utf8')
      sse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      })
    }
    if (delta.content) {
      openText()
      textBytes += Buffer.byteLength(delta.content, 'utf8')
      sse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: delta.content },
      })
    }
    for (const part of delta.tool_calls ?? []) {
      const key = part.index ?? 0
      const current = toolCalls.get(key) ?? { id: null, name: null, arguments: '' }
      if (part.id) current.id = part.id
      if (part.function?.name) current.name = part.function.name
      if (part.function?.arguments) current.arguments += part.function.arguments
      toolCalls.set(key, current)
    }
    if (choice.finish_reason) finalReason = choice.finish_reason
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        consumeChunk(JSON.parse(raw))
      }
    }
    buffered += decoder.decode()
    for (const line of buffered.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      consumeChunk(JSON.parse(raw))
    }

    closeThinking()
    closeText()

    for (const [, call] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
      const index = blockIndex++
      sse(response, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: call.id ?? `toolu_local_${randomUUID().replaceAll('-', '')}`,
          name: call.name ?? 'unknown_tool',
          input: {},
        },
      })
      sse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(parseToolInput(call.arguments)),
        },
      })
      sse(response, 'content_block_stop', { type: 'content_block_stop', index })
    }

    const outputTokens = usage?.completion_tokens ?? Math.max(
      1,
      Math.ceil((textBytes + reasoningBytes) / 3),
    )
    sse(response, 'message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: finishReason(finalReason, toolCalls.size > 0),
        stop_sequence: null,
      },
      usage: { output_tokens: outputTokens },
    })
    sse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  } catch (error) {
    log(`stream translation failed: ${error.stack ?? error.message}`)
    if (!response.destroyed && !response.writableEnded) {
      sse(response, 'error', {
        type: 'error',
        error: { type: 'api_error', message: error.message },
      })
      response.end()
    }
  } finally {
    clearInterval(pingTimer)
  }
}

function makeModelMap(catalog) {
  const models = new Map()
  for (const model of catalog.models ?? []) {
    for (const id of [model.id, ...(model.legacy_ids ?? [])]) {
      if (models.has(id)) throw new Error(`Duplicate model id: ${id}`)
      if (!/(claude|anthropic)/i.test(id)) {
        throw new Error(`Claude discovery model id must contain claude or anthropic: ${id}`)
      }
      models.set(id, model)
    }
  }
  return models
}

function requestAuthorized(request, token) {
  if (!token) return true
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  return bearer === token || request.headers['x-api-key'] === token
}

export function createGatewayServer({
  catalog,
  upstreamBaseURL = catalog.upstream_base_url,
  token = '',
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  logger = message => process.stdout.write(`${new Date().toISOString()} ${message}\n`),
} = {}) {
  if (!catalog?.models?.length) throw new Error('The catalog has no models')
  const models = makeModelMap(catalog)
  const upstreamRoot = `${upstreamBaseURL.replace(/\/$/, '')}/`

  async function upstreamHealth() {
    try {
      const response = await fetch(new URL('../health', upstreamRoot), {
        signal: AbortSignal.timeout(1500),
      })
      return response.ok
        ? await response.json()
        : { status: 'error', http_status: response.status }
    } catch (error) {
      return { status: 'offline', error: error.message }
    }
  }

  function modelList() {
    return {
      data: catalog.models.map(model => ({
        type: 'model',
        id: model.id,
        display_name: model.display_name,
        context_window: model.context_window,
        max_output_tokens: model.max_output_tokens,
        supports_vision: Boolean(model.supports_vision),
      })),
      has_more: false,
    }
  }

  async function handleMessages(request, response, payload) {
    const model = models.get(payload.model)
    if (!model) {
      anthropicError(
        response,
        404,
        `Unknown local model '${payload.model}'`,
        'not_found_error',
      )
      return
    }

    let translated
    try {
      translated = toOpenAIRequest(payload, model)
    } catch (error) {
      anthropicError(response, 400, error.message, 'invalid_request_error')
      return
    }

    const inferenceMode = translated.hasImages ? 'vision' : 'text'
    logger(
      `request ${payload.model} -> ${model.upstream_model}` +
      ` stream=${Boolean(payload.stream)} mode=${inferenceMode}`,
    )
    const controller = new AbortController()
    const abortUpstream = () => controller.abort()
    request.once('aborted', abortUpstream)
    response.once('close', abortUpstream)

    let upstream
    try {
      upstream = await fetch(new URL('chat/completions', upstreamRoot), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-local-client': 'claude-code',
          'x-local-mode': inferenceMode,
        },
        body: JSON.stringify(translated.request),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted && (response.destroyed || response.writableEnded)) {
        logger(`client disconnected from ${payload.model}`)
        return
      }
      anthropicError(response, 503, `Local inference server unavailable: ${error.message}`)
      return
    }

    if (!upstream.ok) {
      const detail = await upstream.text()
      anthropicError(
        response,
        upstream.status,
        `Local inference server returned HTTP ${upstream.status}: ${detail}`,
      )
      return
    }

    if (payload.stream) {
      await streamOpenAIAsAnthropic(
        upstream,
        response,
        payload.model,
        translated.inputTokens,
        logger,
      )
    } else {
      const result = await upstream.json()
      writeJson(
        response,
        200,
        fromOpenAIResponse(result, payload.model, translated.inputTokens),
      )
    }
  }

  return http.createServer(async (request, response) => {
    response.on('error', error => logger(`response error: ${error.message}`))
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (request.method === 'HEAD' && url.pathname === '/api/hello') {
        response.writeHead(204).end()
        return
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, {
          status: 'ok',
          service: 'qwen-claude-code-bridge',
          models: catalog.models.length,
          upstream: await upstreamHealth(),
        })
        return
      }
      if (!requestAuthorized(request, token)) {
        anthropicError(response, 401, 'Invalid gateway credential', 'authentication_error')
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        writeJson(response, 200, modelList())
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
        const id = decodeURIComponent(url.pathname.slice('/v1/models/'.length))
        const model = models.get(id)
        if (!model) {
          anthropicError(response, 404, `Unknown model '${id}'`, 'not_found_error')
          return
        }
        writeJson(response, 200, {
          ...modelList().data.find(item => item.id === model.id),
          id,
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
        const payload = JSON.parse((await readBody(request, maxBodyBytes)).toString('utf8'))
        writeJson(response, 200, { input_tokens: estimateInputTokens(payload) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/messages') {
        const payload = JSON.parse((await readBody(request, maxBodyBytes)).toString('utf8'))
        await handleMessages(request, response, payload)
        return
      }
      anthropicError(
        response,
        404,
        `Unsupported route ${request.method} ${url.pathname}`,
        'not_found_error',
      )
    } catch (error) {
      logger(`request failed: ${error.stack ?? error.message}`)
      if (!response.headersSent) {
        anthropicError(response, 400, error.message, 'invalid_request_error')
      } else if (!response.destroyed) {
        response.destroy(error)
      }
    }
  })
}

export async function loadCatalog(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const configPath = resolve(
    process.env.QWEN_CLAUDE_CONFIG ?? join(here, '..', 'config', 'models.json'),
  )
  const catalog = await loadCatalog(configPath)
  const host = process.env.QWEN_CLAUDE_HOST ?? '127.0.0.1'
  const port = Number(process.env.QWEN_CLAUDE_PORT ?? 8094)
  const server = createGatewayServer({
    catalog,
    upstreamBaseURL: process.env.QWEN_CLAUDE_UPSTREAM ?? catalog.upstream_base_url,
    token: process.env.QWEN_CLAUDE_TOKEN ?? '',
  })
  server.keepAliveTimeout = 5 * 60 * 1000
  server.headersTimeout = 5 * 60 * 1000 + 1000
  server.requestTimeout = 0
  server.listen(port, host, () => {
    process.stdout.write(`Qwen Claude Code bridge: http://${host}:${port}\n`)
    process.stdout.write(`Models: ${catalog.models.length}; config: ${configPath}\n`)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)))
  }
}

