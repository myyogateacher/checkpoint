import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Registers document/window/etc. as globals for the component tests. It has to run
// before React is imported, and ES module imports are hoisted above any statement
// in the test file itself, so this lives in a preload rather than at the top of a
// test. `bun run test:ui` passes it with --preload; the server suite runs without
// it, because happy-dom also replaces fetch/Request/Response and server/lib/http.ts
// builds real Requests.
GlobalRegistrator.register()

// React only treats act() as real when this is set; without it act() is a no-op and
// every state update from an async effect prints an "not wrapped in act" warning
// even though the test is correct. Vitest/Jest set it from their own environment
// detection, bun does not.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
