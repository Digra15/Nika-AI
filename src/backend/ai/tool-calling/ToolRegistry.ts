import type { ToolDefinition } from "../../../shared/types/index.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.function.name, { definition, handler });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" is not registered`);
    }
    return entry.handler(args);
  }
}
