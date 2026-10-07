// Fails fast, with instructions, when the running Node.js cannot provide the built-in `node:sqlite` module.
// node:sqlite is available without flags from Node 22.13.0 (22.x line) and 23.4.0 (23.x line); all of 24+.
export function isSupported(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const v = process.version;
  if (!isSupported(process.env.EXCEPTIONIQ_SIMULATE_NODE_VERSION ?? v)) {
    console.error(`
  ExceptionIQ needs Node.js 22.13 or newer (22 LTS or 24 LTS). You are running ${process.env.EXCEPTIONIQ_SIMULATE_NODE_VERSION ?? v}.
  The backend stores data with Node's built-in "node:sqlite" module, which older versions don't have.

  How to fix:
    Windows (nvm-windows):  nvm install 22   then   nvm use 22
    macOS / Linux (nvm):    nvm install 22   then   nvm use 22
    Or download the LTS installer from https://nodejs.org

  Then open a NEW terminal, check with "node -v", and run "npm run dev" again.
`);
    process.exit(1);
  }
}
