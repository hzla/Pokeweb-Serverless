import type { StandaloneStreamConfig } from "./projectStore";

export const STANDALONE_STREAM_MANIFEST_PATH = "ui/streamed-music/library.json";
const MAGIC = "PokewebStandaloneStreams";

export function encodeStandaloneStreamManifest(configs: readonly StandaloneStreamConfig[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ magic: MAGIC, version: 1, streams: configs }));
}

export function decodeStandaloneStreamManifest(bytes: Uint8Array): StandaloneStreamConfig[] {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== "object") throw new Error("Standalone stream manifest is malformed.");
  const root = parsed as Record<string, unknown>;
  if (root.magic !== MAGIC || root.version !== 1 || !Array.isArray(root.streams)) {
    throw new Error("Standalone stream manifest has an unsupported format.");
  }
  const streams = root.streams as Array<Record<string, unknown>>;
  const ids = new Set<number>();
  for (const stream of streams) {
    if (!stream || !Number.isInteger(stream.streamId) || Number(stream.streamId) < 0 || Number(stream.streamId) >= 0xffff
      || !Number.isInteger(stream.streamFileId) || Number(stream.streamFileId) < 0 || Number(stream.streamFileId) >= 0xffff
      || typeof stream.name !== "string" || !stream.name.trim() || stream.name.length > 80
      || typeof stream.sourceName !== "string" || stream.sourceName.length > 256
      || (stream.encoding !== "pcm16" && stream.encoding !== "adpcm")
      || stream.sampleRate !== 32728 || !Number.isInteger(stream.sampleCount)
      || !Number.isInteger(stream.loopStartSample) || !Number.isInteger(stream.loopEndSample)
      || !Number.isInteger(stream.encodedBytes) || typeof stream.audioSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(stream.audioSha256) || ids.has(Number(stream.streamId))) {
      throw new Error("Standalone stream manifest contains an invalid track.");
    }
    ids.add(Number(stream.streamId));
  }
  return streams as StandaloneStreamConfig[];
}
