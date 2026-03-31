# Agent Guidelines for Gambit CLI

## Build/Test Commands
- **Install**: `bun install`
- **Run dev**: `bun run src/index.tsx`
- **Test all**: `bun test`
- **Test single**: `bun test src/lib/specific.test.ts`
- **Type check**: `bun run tsc --noEmit`

## Code Style Guidelines
- **Imports**: Group by type (node: first, then external, then local); use absolute paths
- **Formatting**: 2-space indentation, trailing commas, single quotes for strings
- **Naming**: camelCase for vars/functions, PascalCase for components/types, kebab-case for files
- **Types**: Strict TypeScript with comprehensive checking; use explicit types over inference
- **JSX**: React JSX with @opentui/react import source; functional components with hooks
- **Error handling**: Try-catch with descriptive messages; prefer async/await over promises
- **Testing**: Bun test runner, co-located `.test.ts` files, Jest-like API with beforeEach/afterEach
