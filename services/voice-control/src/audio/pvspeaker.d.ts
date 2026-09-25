// @picovoice/pvspeaker-node ships typings in dist/types but its package.json
// has no "types" entry, so point TypeScript at them.
declare module "@picovoice/pvspeaker-node" {
  export { PvSpeaker } from "@picovoice/pvspeaker-node/dist/types/index.js";
}
