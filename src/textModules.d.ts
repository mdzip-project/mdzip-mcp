// esbuild inlines .md files as strings (--loader:.md=text).
declare module '*.md' {
  const text: string;
  export default text;
}
