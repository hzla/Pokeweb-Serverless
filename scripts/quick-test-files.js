// Broad regression coverage for the opt-in [quick tests] deployment marker.
// This is a curated subset, not a random shard; npm test still runs every file.
export const QUICK_TEST_FILES = [
  // ROM identity, binary containers, compression, and export integrity.
  "src/test/arm9ModuleParams.test.ts",
  "src/test/codeCompression.test.ts",
  "src/test/dsiDigest.test.ts",
  "src/test/dsiRomRepair.test.ts",
  "src/test/frostCompatibility.test.ts",
  "src/test/loader.test.ts",
  "src/test/narc.test.ts",
  "src/test/romDetection.test.ts",
  "src/test/romExport.test.ts",
  "src/test/romImportPersistence.test.ts",
  "src/test/romViews.test.ts",

  // Durable edits, undo, autosave, and source-ROM recovery.
  "src/test/actionUndo.test.ts",
  "src/test/editSession.test.ts",
  "src/test/persistence.test.ts",
  "src/test/projectDocument.test.ts",
  "src/test/projectPersistence.test.ts",
  "src/test/projectSaveScheduler.test.ts",

  // Core data editors and script round trips across supported ROM families.
  "src/test/bw2ScriptModel.test.ts",
  "src/test/encounterModel.test.ts",
  "src/test/fileSystemModel.test.ts",
  "src/test/gen4Text.test.ts",
  "src/test/headerModel.test.ts",
  "src/test/matrixModel.test.ts",
  "src/test/moveItemModel.test.ts",
  "src/test/pokemonFormModel.test.ts",
  "src/test/pokemonModel.test.ts",
  "src/test/textModel.test.ts",
  "src/test/trainerModel.test.ts",

  // Native patch installation, packaging, and primary launch/navigation flows.
  "src/test/codeInjectionInstall.test.ts",
  "src/test/pmcModel.test.ts",
  "src/test/romPatchModel.test.ts",
  "src/test/runtimePackaging.test.ts",
  "src/test/navigationDropdowns.test.ts",
  "src/test/testBattle.test.ts",
];
