// @ts-check
// async-generation.js — async image generation tool with task polling and queue guard (#460).
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  makeProviders,
  toLosslessJson,
  PROVIDER_KEYS,
} from '../providers.js'
import { renderToolOutput } from '../attachment-helper.js'
import { resolveFallbackChain, executeWithFallback } from '../fallback-router.js'
import { calculateGenerationCost, assertBudgetAvailable, reserveSpend } from '../cost-meter.js'
import { sanitizeErrorAndLogs } from '../security.js'
import { defaultTaskRegistry, TASK_STATUSES } from '../async-task-manager.js'

export function registerAsyncGenerationTools(ctx, deps) {
  const {
    live,
    saveAndAttachResult,
    slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveApiKey,
    taskRegistry = defaultTaskRegistry,
  } = deps

  ctx.effect(() => {
    ctx.tools.register(
      defineTool({
        name: 'async_generate_image',
        description:
          'Asynchronous image generation pipeline with task polling and queue guard (#460). '
          + 'Returns a task_id immediately for long-running models (wait: false), or automatically '
          + 'polls with exponential backoff until completion (wait: true, default).',
        parameters: {
          prompt: {
            type: 'string',
            description: 'Image description or visual prompt to generate (required for new tasks).',
          },
          task_id: {
            type: 'string',
            description: 'Existing task identifier to inspect or poll for completion.',
          },
          wait: {
            type: 'boolean',
            description: 'When true (default), polls with exponential backoff until generation finishes. When false, returns task_id immediately.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Maximum polling timeout in seconds (default: 120).',
          },
          image_size: {
            type: 'string',
            description: 'Output image dimensions (e.g. square_hd, landscape_16_9).',
          },
          seed: {
            type: 'integer',
            description: 'Optional seed for reproducible generation.',
          },
          provider: {
            type: 'string',
            description: 'Optional provider override (e.g. fal, replicate, local).',
          },
          style_preset: {
            type: 'string',
            description: 'Optional style preset (e.g. photorealistic, anime, cinematic).',
          },
          output_name: {
            type: 'string',
            description: 'Optional stem name for exported file.',
          },
          output_dir: {
            type: 'string',
            description: 'Optional custom directory to write the image into.',
          },
        },
        output: {
          render: (_args, value) => renderToolOutput(value),
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              summary: { type: 'string' },
              taskId: { type: 'string' },
              status: { type: 'string' },
              stage: { type: 'string' },
              progress: { type: 'number' },
              path: { type: 'string' },
              url: { type: 'string' },
              attachment: { type: 'object', additionalProperties: true },
              provider: { type: 'string' },
              cost: { type: 'number' },
            },
          },
        },
        async execute(args, execCtx) {
          try {
            const cfg = typeof live === 'function' ? live() : (deps.config || {})
            const wait = args.wait !== false
            const timeoutMs = Math.max(5000, Math.min(600000, (args.timeout_seconds || 120) * 1000))

            // 1. Polling existing task by task_id
            if (args.task_id && !args.prompt) {
              const existingTask = taskRegistry.getTask(args.task_id)
              if (!existingTask) {
                throw new Error(`Task "${args.task_id}" not found`)
              }

              if (existingTask.status === TASK_STATUSES.COMPLETED) {
                return toLosslessJson(existingTask.result)
              }

              if (!wait) {
                return toLosslessJson({
                  summary: `### Async Task Status: ${existingTask.status.toUpperCase()}\n- **Task ID**: \`${existingTask.id}\`\n- **Progress**: ${existingTask.progress}%\n- **Stage**: ${existingTask.stage}`,
                  taskId: existingTask.id,
                  status: existingTask.status,
                  stage: existingTask.stage,
                  progress: existingTask.progress,
                })
              }

              // Wait with exponential backoff
              const polled = await taskRegistry.pollTaskWithBackoff(existingTask.id, {
                timeoutMs,
                signal: execCtx?.signal,
              })

              if (polled.status === TASK_STATUSES.COMPLETED) {
                return toLosslessJson(polled.result)
              }

              return toLosslessJson({
                summary: `### Async Task Incomplete\n- **Task ID**: \`${polled.id}\`\n- **Status**: ${polled.status}\n- **Message**: ${polled.message || polled.stage}`,
                taskId: polled.id,
                status: polled.status,
                stage: polled.stage,
                progress: polled.progress,
              })
            }

            // 2. Creating and launching a new generation task
            const prompt = String(args.prompt || '').trim()
            if (!prompt) {
              throw new Error('async_generate_image requires a prompt to initiate a generation task.')
            }

            const provider = args.provider || cfg.provider || 'fal'
            const size = args.image_size || cfg.defaultSize || 'square_hd'
            const seed = args.seed ?? Math.floor(Math.random() * 100000)

            const estimatedCost = calculateGenerationCost({
              provider,
              model: cfg.model || cfg.customModel || 'default',
              size,
              count: 1,
            })
            assertBudgetAvailable(estimatedCost, cfg.dailyBudgetUsd)

            // Register new async task
            const task = taskRegistry.createTask({
              prompt,
              params: args,
              session: execCtx?.agent?.session,
            })

            // Launch worker function in background
            taskRegistry.runBackgroundTask(task.id, async (onProgress) => {
              onProgress({ progress: 10, stage: 'Reserving spend and preparing model payload' })

              const reservation = reserveSpend(estimatedCost, cfg.dailyBudgetUsd)
              let committed = false

              try {
                let subscriptionImages
                try { subscriptionImages = ctx.get && ctx.get('subscriptionImages') } catch (_err) { subscriptionImages = undefined }

                const job = {
                  prompt,
                  size,
                  format: 'png',
                  seed,
                  provider,
                  signal: execCtx?.signal,
                }

                const providers = makeProviders(
                  { fetchImpl: fetch, resolveKey: (ref) => resolveApiKey(ctx, ref), cfg, subscriptionImages },
                  job,
                )
                const fallbackChain = resolveFallbackChain(provider, cfg.fallbackProviders, PROVIDER_KEYS)

                onProgress({ progress: 30, stage: 'Submitting job to provider queue' })

                const gen = await executeWithFallback(
                  providers,
                  fallbackChain,
                  seed,
                  prompt,
                  { logger: ctx.logger },
                )

                onProgress({ progress: 80, stage: 'Saving asset artifact and sidecar' })

                const usedProvider = gen._fallback?.providerUsed || provider
                const effectiveCost = Number(gen.cost) || estimatedCost
                reservation.commit(effectiveCost, {
                  ctx,
                  meta: { provider: usedProvider, model: cfg.model || cfg.customModel, prompt, seed },
                })
                committed = true

                const stem = args.output_name
                  ? slugify(args.output_name)
                  : `async-${usedProvider}-${seed}`
                const filename = `${stem}.png`

                let result
                if (typeof saveAndAttachResult === 'function') {
                  result = await saveAndAttachResult(ctx, execCtx, cfg, {
                    bytes: gen.bytes,
                    mediaType: gen.mediaType || 'image/png',
                    name: filename,
                    stem,
                    prompt,
                    size,
                    format: 'png',
                    seed: gen.seed ?? seed,
                    provider: usedProvider,
                    cost: effectiveCost,
                    deliverAs: cfg.deliverAs || 'both',
                    args,
                    action: 'generated_async',
                  })
                } else {
                  result = {
                    path: filename,
                    url: filename,
                    attachment: { attachmentId: `async-${seed}`, url: filename },
                  }
                }

                onProgress({ progress: 100, stage: 'Finished' })

                const summary = [
                  '### Async Generation Completed',
                  `- **Task ID**: \`${task.id}\``,
                  `- **Prompt**: ${prompt}`,
                  `- **Output Image**: \`${result.path || filename}\``,
                  `- **Provider**: ${usedProvider}`,
                ].join('\n')

                return {
                  summary,
                  taskId: task.id,
                  status: TASK_STATUSES.COMPLETED,
                  stage: 'Completed',
                  progress: 100,
                  path: result.path,
                  url: result.url,
                  attachment: result.attachment,
                  provider: usedProvider,
                  cost: effectiveCost,
                }
              } finally {
                if (!committed) {
                  reservation.release()
                }
              }
            })

            // If caller does not want to wait, return immediately with task_id
            if (!wait) {
              return toLosslessJson({
                summary: [
                  '### Async Image Task Enqueued',
                  `- **Task ID**: \`${task.id}\``,
                  `- **Prompt**: ${prompt}`,
                  `- **Status**: QUEUED`,
                  `- **Note**: Call \`async_generate_image\` with \`task_id: "${task.id}"\` to query status or wait.`,
                ].join('\n'),
                taskId: task.id,
                status: TASK_STATUSES.QUEUED,
                stage: task.stage,
                progress: 0,
              })
            }

            // Otherwise, wait with exponential backoff
            const completedTask = await taskRegistry.pollTaskWithBackoff(task.id, {
              timeoutMs,
              signal: execCtx?.signal,
            })

            if (completedTask.status === TASK_STATUSES.COMPLETED) {
              return toLosslessJson(completedTask.result)
            }

            return toLosslessJson({
              summary: `### Async Generation Still In Progress\n- **Task ID**: \`${completedTask.id}\`\n- **Status**: ${completedTask.status}\n- **Stage**: ${completedTask.stage}`,
              taskId: completedTask.id,
              status: completedTask.status,
              stage: completedTask.stage,
              progress: completedTask.progress,
            })
          } catch (err) {
            throw new Error(sanitizeErrorAndLogs(err.message || err))
          }
        },
      }),
    )
  }, 'dsh-image-gen: tool async_generate_image')
}

