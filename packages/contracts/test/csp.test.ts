import { config } from 'zod';
import { describe, expect, it, vi } from 'vitest';

describe('zod under a CSP without unsafe-eval', () => {
  it('builds and runs the schemas without constructing a Function', async () => {
    const FunctionConstructor = globalThis.Function;
    const constructed = vi.fn();
    // Records `new Function(...)` and still builds the function.
    globalThis.Function = new Proxy(FunctionConstructor, {
      construct(target, args: string[]) {
        constructed(args);
        return Reflect.construct(target, args) as object;
      },
    });
    try {
      const { productList, telemetryBody } = await import('../src/index.js');
      expect(config().jitless).toBe(true);
      productList.safeParse([{ id: 1 }]);
      telemetryBody.safeParse({ eventType: 'catalogue_loaded', payload: { count: 1 } });
      expect(constructed).not.toHaveBeenCalled();
    } finally {
      globalThis.Function = FunctionConstructor;
    }
  });
});
