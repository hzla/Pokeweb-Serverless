# Parsed typed Ruby source; edit this file, then rebuild.

global :learnsetConfig, { type: "volatile Config", scope: "global", export: true, section: ".learnset_config" }, aggregate("volatile Config", aggregate("u8[8]", cast("char", 76), cast("char", 83), cast("char", 86), cast("char", 77), cast("char", 83), cast("char", 71), cast("char", 49), 0), 1, End, 0, End, 0, End, 0, 0)

global :customUiConfig, { type: "volatile CustomConfig", scope: "global", export: true, section: ".custom_ui_config" }, aggregate("volatile CustomConfig", aggregate("u8[8]", cast("char", 80), cast("char", 87), cast("char", 85), cast("char", 73), cast("char", 67), cast("char", 70), cast("char", 71), cast("char", 49)), 1, 0, End, 0, 1, 0)
