import { describe, expect, it } from "vitest";
import type { NitroSdat, NitroSequenceInfo } from "../pokeweb/nitroSound";
import { listMusicEditorSequences, renderInstalledMusicRows, renderStreamedBgmEncodingOptions } from "../ui/musicEditor";
import type { StreamedBgmConfig } from "../pokeweb/projectStore";

describe("Music editor sequence list", () => {
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
});

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
