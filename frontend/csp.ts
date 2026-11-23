// Content Security Policy for the dev server, the preview server and nginx
// (nginx.conf holds the same string; a test keeps them equal).
//
// Beyond 'self':
// - 'wasm-unsafe-eval': the landmark worker compiles the MediaPipe WASM.
// - connect-src blob: GLTFLoader fetches textures embedded in GLB files
//   through blob: URLs.
// - connect-src <API origin>: catalogue and telemetry requests.
// - nonce (dev only): Vite and React Fast Refresh inject inline scripts and styles.

export interface CspOptions {
  apiOrigin: string;
  nonce?: string;
}

export const apiOriginOf = (apiUrl: string): string => new URL(apiUrl).origin;

export const contentSecurityPolicy = ({ apiOrigin, nonce }: CspOptions): string => {
  const nonceSource = nonce ? [`'nonce-${nonce}'`] : [];
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'", ...nonceSource]],
    ['style-src', ["'self'", ...nonceSource]],
    ['worker-src', ["'self'"]],
    ['connect-src', ["'self'", 'blob:', apiOrigin]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
};
