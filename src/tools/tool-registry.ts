import type { ToolDefinition } from './tool-types'

/**
 * In-memory registry for built-in tools. Tools are keyed by their `id` and
 * must be unique. The registry is consumed by `ToolExecutor` and by the
 * adapter layer that exposes tools to the Vercel AI SDK.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>()

  constructor(definitions: ToolDefinition<any, any>[] = []) {
    for (const definition of definitions) {
      this.register(definition)
    }
  }

  register(definition: ToolDefinition<any, any>): void {
    if (this.tools.has(definition.id)) {
      throw new Error(`Tool already registered: ${definition.id}`)
    }
    this.tools.set(definition.id, definition)
  }

  get(id: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(id)
  }

  list(): ToolDefinition<any, any>[] {
    return Array.from(this.tools.values())
  }
}

export function createToolRegistry(definitions: ToolDefinition<any, any>[] = []): ToolRegistry {
  return new ToolRegistry(definitions)
}
