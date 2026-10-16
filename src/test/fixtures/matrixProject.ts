import { writeU16, writeU32 } from "../../nds/binary";
import { NARC } from "../../nds/narc";
import { getNarcFormats } from "../../pokeweb/formats";
import { parseHeaders } from "../../pokeweb/headerModel";
import { GEN5_MATRIX_EMPTY } from "../../pokeweb/gen5MatrixModel";
import { createNarcStore } from "../../pokeweb/projectStore";
import { makeEditProject } from "./editProject";

export function matrixBytes(width: number, height: number, maps: number[], headers?: number[], footer = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(8 + width * height * (headers ? 8 : 4) + footer.length);
  writeU32(bytes, 0, headers ? 1 : 0); writeU16(bytes, 4, width); writeU16(bytes, 6, height);
  maps.forEach((map, i) => writeU32(bytes, 8 + i * 4, map));
  headers?.forEach((header, i) => writeU32(bytes, 8 + width * height * 4 + i * 4, header));
  bytes.set(footer, bytes.length - footer.length); return bytes;
}

export function makeMatrixProject(baseRom: "BW" | "BW2" = "BW2") {
  const project = makeEditProject(); project.session.baseRom = baseRom; project.session.baseVersion = baseRom === "BW" ? "B" : "W2";
  project.formats = getNarcFormats(baseRom);
  const format = project.formats.headers!, rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const headerData = new Uint8Array(rowLength * 3);
  for (let i = 0; i < 3; i++) {
    let offset = i * rowLength;
    for (const [size, field] of format) {
      if (field === "matrix_id") writeU16(headerData, offset, i === 1 ? 1 : 0);
      offset += size;
    }
  }
  const archive = (files: Uint8Array[]) => { const narc = new NARC(); narc.files = files; return narc; };
  project.narcs = {
    matrix: createNarcStore("matrix", "a/0/0/9", 0, archive([
      matrixBytes(3, 2, [0, 1, GEN5_MATRIX_EMPTY, 2, 3, 4], [0, 0, GEN5_MATRIX_EMPTY, 1, 2, 2], Uint8Array.of(0xaa, 0xbb)),
      matrixBytes(2, 1, [5, 6], undefined, Uint8Array.of(1, 2, 3, 4)),
    ])),
    headers: createNarcStore("headers", "a/0/1/2", 1, archive([headerData])),
    maps: createNarcStore("maps", "a/0/0/8", 2, archive(Array.from({ length: 8 }, () => Uint8Array.of(1)))),
  };
  project.texts.banks.locations = ["Test Town"];
  project.headers = parseHeaders(project);
  return project;
}
