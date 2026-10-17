import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement ResizeObserver; Radix primitives (Checkbox, Select) observe their size.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverShim {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(window, { ResizeObserver: ResizeObserverShim })
  Object.assign(globalThis, { ResizeObserver: ResizeObserverShim })
}

afterEach(() => cleanup())
