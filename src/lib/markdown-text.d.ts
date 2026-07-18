// Bun's text loader (`import ... with { type: "text" }`) resolves markdown
// imports to their file contents as a string, both at runtime and when
// bundling with `bun build --compile`.
declare module "*.md" {
  const text: string;
  export default text;
}
