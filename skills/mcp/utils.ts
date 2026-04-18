import { z } from "zod";

export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  const s = schema as { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[]; items?: Record<string, unknown>; enum?: unknown[]; description?: string };

  if (s.type === "object") {
    const shape: Record<string, z.ZodTypeAny> = {};
    const props = s.properties || {};
    const required = new Set(s.required || []);
    for (const [key, val] of Object.entries(props)) {
      const field = jsonSchemaToZod(val as Record<string, unknown>);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape).passthrough();
  }
  if (s.type === "array") {
    return z.array(jsonSchemaToZod(s.items as Record<string, unknown>));
  }
  if (s.type === "string") {
    if (s.enum && Array.isArray(s.enum)) return z.enum(s.enum as [string, ...string[]]);
    return z.string();
  }
  if (s.type === "number" || s.type === "integer") return z.number();
  if (s.type === "boolean") return z.boolean();
  return z.any();
}
