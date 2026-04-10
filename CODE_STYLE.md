# Code Style

- TypeScript strict mode. Prefer `type` over `interface` for unions/intersections.
- Named exports everywhere. Relative imports only, no path aliases.
- English for all comments and code.
- **Arrow functions**: Always use arrow functions (`const fn = () => {}`) — never the `function` keyword, for any purpose (helpers, callbacks, module-level utilities).
- **Functional programming style**: No `class` keyword. Prefer factory functions over classes. Use closures for stateful encapsulation. Stateful modules export a `createX()` factory that returns a plain object with typed methods. For event-based modules, expose `on` bound from an internal `EventEmitter` instance rather than subclassing it.
