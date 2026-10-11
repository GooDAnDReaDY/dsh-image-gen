import {
  enqueueBatch,
  getBatchQueue,
  getBatchProgress,
  cancelBatch,
  retryFailedBatchItems,
} from '../batch-queue.js'

/**
 * Registers batch queue management tools (#437).
 */
export function registerBatchQueueTools(ctx, deps = {}) {
  ctx.tools.register({
    name: 'enqueue_batch_jobs',
    description: 'Enqueues a series of generation or processing jobs with budget pre-flight check and concurrency control.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Descriptive title for the batch.',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              tool: { type: 'string' },
              params: { type: 'object', additionalProperties: true },
              estimatedCost: { type: 'number' },
            },
          },
          description: 'Array of jobs to execute.',
        },
        concurrency: {
          type: 'number',
          description: 'Maximum concurrent active workers (default 2, max 10).',
        },
        maxBudgetUSD: {
          type: 'number',
          description: 'Maximum total allowed budget in USD for this entire batch.',
        },
      },
      required: ['items'],
    },
    output: {
      render(args, value) {
        return [
          {
            type: 'text',
            text: `Enqueued Batch: [${value?.batchId}] "${value?.name}"\n` +
              `Total Jobs: ${value?.items?.length} | Estimated Cost: $${value?.totalEstimatedCost?.toFixed(3)}\n` +
              `Status: ${value?.status} | Concurrency: ${value?.concurrency}`,
          },
        ]
      },
    },
    async execute(args) {
      const storagePath = deps.queueStoragePath || null
      return enqueueBatch(
        {
          name: args.name,
          items: args.items,
          concurrency: args.concurrency || 2,
          maxBudget: args.maxBudgetUSD || Infinity,
        },
        storagePath
      )
    },
  })

  ctx.tools.register({
    name: 'manage_batch_queue',
    description: 'Manages batch queues: status inquiry, cancellation, or retrying failed items.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        batchId: {
          type: 'string',
          description: 'Target batch queue identifier.',
        },
        action: {
          type: 'string',
          enum: ['status', 'cancel', 'retry_failed'],
          description: 'Action to perform: check status, cancel, or retry failed items.',
        },
        itemId: {
          type: 'string',
          description: 'Optional single item ID to cancel.',
        },
      },
      required: ['batchId', 'action'],
    },
    output: {
      render(args, value) {
        if (args.action === 'status') {
          const p = value?.progress || {}
          return [
            {
              type: 'text',
              text: `Batch [${args.batchId}] Status: ${value?.status} (${p.percent}%)\n` +
                `Total: ${p.total} | Completed: ${p.completed} | Failed: ${p.failed} | Queued: ${p.queued} | Running: ${p.running} | Interrupted: ${p.interrupted || 0}`,
            },
          ]
        }
        if (args.action === 'cancel') {
          return [{ type: 'text', text: `Cancelled batch [${args.batchId}]. Queued jobs discarded.` }]
        }
        if (args.action === 'retry_failed') {
          return [{ type: 'text', text: `Reset ${value?.resetCount || 0} failed items for retry in batch [${args.batchId}].` }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args) {
      const storagePath = deps.queueStoragePath || null
      if (args.action === 'status') {
        const batch = getBatchQueue(args.batchId, storagePath)
        if (!batch) return { ok: false, error: `Batch "${args.batchId}" not found` }
        return { ok: true, batchId: batch.batchId, status: batch.status, progress: getBatchProgress(batch), items: batch.items }
      }
      if (args.action === 'cancel') {
        return cancelBatch(args.batchId, args.itemId, storagePath)
      }
      if (args.action === 'retry_failed') {
        return retryFailedBatchItems(args.batchId, args.itemId ? [args.itemId] : null, storagePath)
      }
      throw new Error(`Unknown action: ${args.action}`)
    },
  })
}
