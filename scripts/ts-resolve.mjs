/**
 * Lets the check scripts import src/ modules directly with Node's built-in type
 * stripping. The app is written for the bundler, so relative imports carry no
 * extension ("./markdown-refs"), which Node's ESM resolver refuses — this hook
 * retries such specifiers with ".ts" (and "/index.ts") before giving up.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/markdown-check.mjs
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      if (!relative || err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context)
        } catch {
          /* try the next suffix */
        }
      }
      throw err
    }
  },
})
