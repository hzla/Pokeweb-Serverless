import { describe, expect, it } from "vitest";
import type { NitroSdat, NitroSequenceInfo } from "../pokeweb/nitroSound";
import type { NativeSdatStream } from "../pokeweb/streamedBgmModel";
import {
  buildNativeStreamReference,
  filterBw1MusicSequences,
  filterNativeStreamReference,
  listMusicEditorSequences,
  nextMusicEditorTab,
  renderInstalledMusicRows,
  renderMusicEditorTabs,
  renderNativeStreamReferenceRows,
  renderStreamedBgmEncodingOptions,
} from "../ui/musicEditor";
import type { StreamedBgmConfig } from "../pokeweb/projectStore";

describe("Music editor sequence list", () => {
  it("shows one selected editing tab and supports keyboard navigation across all three workflows", () => {
    const html = renderMusicEditorTabs("streamed");
    expect(html).toContain('aria-controls="music-editor-panel-bgm"');
    expect(html).toContain('aria-controls="music-editor-panel-streamed"');
    expect(html).toContain('aria-controls="music-editor-panel-standalone"');
    expect(html).toContain('data-music-editor-tab="bgm">BGM Replacements</button>');
    expect(html).toContain('data-music-editor-tab="streamed">Streamed Replacements</button>');
    expect(html).toContain('data-music-editor-tab="standalone">Standalone</button>');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(nextMusicEditorTab("standalone", "ArrowRight")).toBe("bgm");
    expect(nextMusicEditorTab("bgm", "ArrowLeft")).toBe("standalone");
    expect(nextMusicEditorTab("streamed", "Home")).toBe("bgm");
    expect(nextMusicEditorTab("bgm", "End")).toBe("standalone");
  });

  it("shows BW1's actual BGM symbols and skips the empty native-stream tab", () => {
    const bw1Tabs = ["bgm", "standalone"] as const;
    const html = renderMusicEditorTabs("standalone", bw1Tabs);
    expect(html).toContain('data-music-editor-tab="standalone"');
    expect(html).not.toContain('data-music-editor-tab="streamed"');
    expect(nextMusicEditorTab("bgm", "ArrowRight", bw1Tabs)).toBe("standalone");
    expect(nextMusicEditorTab("standalone", "ArrowRight", bw1Tabs)).toBe("bgm");
    expect(filterBw1MusicSequences([
      { id: 1003, symbol: "SEQ_BGM_TITLE" },
      { id: 1128, symbol: "SEQ_BGM_VS_NORAPOKE" },
    ], "vs_nora")).toEqual([{ id: 1128, symbol: "SEQ_BGM_VS_NORAPOKE" }]);
    expect(filterBw1MusicSequences([{ id: 1003, symbol: "SEQ_BGM_TITLE" }], "1003")).toHaveLength(1);
  });

  it("creates a dense selector list from an SDAT with empty sequence slots", () => {
    const sequenceInfos: NitroSdat["sequenceInfos"] = new Array(1130);
    sequenceInfos[1] = sequence(1, "SEQ_PV001");
    sequenceInfos[1128] = sequence(1128, "SEQ_BGM_VS_NORAPOKE");
    sequenceInfos[1129] = sequence(1129, "SEQ_BGM_VS_TSUYOPOKE");

    const sequences = listMusicEditorSequences({ sequenceInfos, sequenceSymbols: [] });

    expect(sequences).toEqual([
      { id: 1128, symbol: "SEQ_BGM_VS_NORAPOKE" },
      { id: 1129, symbol: "SEQ_BGM_VS_TSUYOPOKE" },
    ]);
    expect(sequences.find((entry) => entry.id === 1128)?.symbol).toBe("SEQ_BGM_VS_NORAPOKE");
  });

  it("renders individually selectable/removable tracks, sorted by ID, with escaped source names", () => {
    const config: StreamedBgmConfig = {
      targetSequenceId: 1128, targetSequenceSymbol: "SEQ_BGM_VS_NORAPOKE", sourceName: '<script>alert("x")</script>.mp3',
      runtimeVersion: 3, sampleRate: 32728, channels: 2, sampleCount: 327280,
      loopStartSample: 32728, loopEndSample: 327280, encodedBytes: 1048576, audioSha256: "test",
      streamId: 1, streamFileId: 5001, shadowFileId: 5000, originalSequenceFileId: 50, toggleEnabled: true,
    };
    const html = renderInstalledMusicRows([config, { ...config, targetSequenceId: 1060, sourceName: "Center.wav" }]);
    expect(html.indexOf("1060")).toBeLessThan(html.indexOf("1128"));
    expect(html).toContain('data-music-remove="1128"');
    expect(html).toContain('data-music-select="1060"');
    expect(html).toContain('aria-label="Remove replacement 1128"');
    expect(html).toContain("1.000–10.000 s");
    expect(html).toContain("1.00 MiB");
    expect(html).not.toContain("<script>");
    expect(config.sourceName).toContain("<script>");
    expect(renderInstalledMusicRows([])).toContain("No replacements installed");
  });

  it("renders the recommended and maximum-quality per-track encodings", () => {
    const recommended = renderStreamedBgmEncodingOptions("adpcm");
    const maximumQuality = renderStreamedBgmEncodingOptions("pcm16");
    expect(recommended).toContain('value="adpcm" selected');
    expect(recommended).toContain('value="pcm16" ');
    expect(maximumQuality).toContain('value="pcm16" selected');
    expect(maximumQuality).toContain("~75% smaller");
    expect(maximumQuality).toContain("Maximum quality");
  });

  it("categorizes native title and sequence-managed custom streams", () => {
    const mapping = streamedConfig(1128, 1);
    const entries = buildNativeStreamReference([
      nativeStream(0, "STRM_TITLE", 5196),
      nativeStream(1, "STRM_1", 5198),
      nativeStream(2, "STRM_EVENT", 5200),
    ], [mapping]);

    expect(entries.map((entry) => entry.category)).toEqual(["title", "custom", "other"]);
    expect(entries[0]).toMatchObject({ title: "Title screen" });
    expect(entries[1]).toMatchObject({ title: "Sequence 1128", managedSequenceId: 1128 });
    expect(filterNativeStreamReference(entries, "STRM_TITLE", "all")).toHaveLength(1);
    expect(filterNativeStreamReference(entries, "1128", "custom")).toEqual([entries[1]]);
    expect(filterNativeStreamReference(entries, "", "title")).toEqual([entries[0]]);
  });

  it("does not label BW1's first added stream as the retail title stream", () => {
    const entries = buildNativeStreamReference([nativeStream(0, "STRM_0", 3874)], []);
    expect(entries[0]).toMatchObject({ category: "other", title: "STRM_0" });
  });

  it("makes direct streams selectable while leaving sequence-managed streams read-only", () => {
    const entries = buildNativeStreamReference([
      nativeStream(0, "STRM_TITLE", 5196),
      nativeStream(1, "STRM_1", 5198),
    ], [streamedConfig(1128, 1)]);
    const html = renderNativeStreamReferenceRows(entries, 0);

    expect(html).toContain('data-native-stream-reference-id="0"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('data-native-stream-reference-id="1"');
    expect(html).toContain("Managed by BGM sequence 1128");
    expect(html).toContain("STRM_TITLE");
  });

  it("shows standalone songs as custom streams without offering direct replacement", () => {
    const entries = buildNativeStreamReference([nativeStream(0, "STRM_TITLE", 1), nativeStream(1, "STRM_1", 3)], [], [{
      streamId: 1, streamFileId: 3, name: "Menu Song", sourceName: "song.wav", encoding: "adpcm", loop: true,
      sampleRate: 32728, sampleCount: 32728, loopStartSample: 0, loopEndSample: 32728,
      encodedBytes: 32768, audioSha256: "a".repeat(64),
    }]);
    expect(entries[1]).toMatchObject({ category: "custom", title: "Menu Song", managedStandalone: true });
    const html = renderNativeStreamReferenceRows(entries, 0);
    expect(html).toContain("Managed as a standalone song");
    expect(html).not.toContain('data-native-stream-reference-id="1"');
  });
});

function streamedConfig(targetSequenceId: number, streamId: number): StreamedBgmConfig {
  return {
    targetSequenceId,
    targetSequenceSymbol: "SEQ_BGM_VS_NORAPOKE",
    sourceName: "Wild.mp3",
    runtimeVersion: 3,
    sampleRate: 32728,
    channels: 2,
    sampleCount: 327280,
    loopStartSample: 0,
    loopEndSample: 327280,
    encodedBytes: 1048576,
    audioSha256: "test",
    streamId,
    streamFileId: 5001,
    shadowFileId: 5000,
    originalSequenceFileId: 50,
    toggleEnabled: true,
  };
}

function nativeStream(id: number, symbol: string, fileId: number): NativeSdatStream {
  return {
    id,
    symbol,
    fileId,
    volume: 127,
    priority: 64,
    playerId: 0,
    encoding: "pcm16",
    loop: false,
    channels: 2,
    sampleRate: 32728,
    loopStartSample: 0,
    sampleCount: 327280,
    encodedBytes: 1310000,
  };
}

function sequence(id: number, symbol: string): NitroSequenceInfo {
  return {
    id,
    fileId: id,
    bankId: 0,
    volume: 127,
    channelPriority: 0,
    playerPriority: 0,
    playerNum: 0,
    symbol,
  };
}
