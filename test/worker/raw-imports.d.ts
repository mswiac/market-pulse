// Vite's `?raw` suffix imports a file's contents as a string (used to read wrangler.toml in tests).
declare module '*?raw' {
  const content: string;
  export default content;
}
