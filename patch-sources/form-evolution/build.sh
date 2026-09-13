#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_parent=$(CDPATH= cd -- "$script_dir/../.." && pwd)
workspace_parent=$(CDPATH= cd -- "$repo_parent/.." && pwd)
toolchain="$workspace_parent/toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"
rpm_tool="$workspace_parent/White2Upgrade/CTRMap.jar"
w2_symbol_db="$workspace_parent/White2Upgrade/pmc/ESDB.yml"
build_dir="$script_dir/build"
asset_dir="$repo_parent/src/assets/codeinjection"

mkdir -p "$build_dir" "$asset_dir"

build_one() {
    game_lower=$1
    game_upper=$2
    symbol_db=$3
    hook_object="$build_dir/form_evolution_${game_lower}.o"
    hook_elf="$build_dir/form_evolution_${game_lower}.elf"
    output="$asset_dir/FormEvolution${game_upper}.dll"

    "$toolchain/arm-none-eabi-g++" \
        -mthumb -mno-thumb-interwork -march=armv5t -mno-long-calls \
        -Os -Wall -Wextra -fno-exceptions -fno-rtti -fno-unwind-tables \
        -fno-asynchronous-unwind-tables -ffreestanding \
        "-DPOKEWEB_GAME_${game_upper}=1" \
        -c "$script_dir/form_evolution.cpp" -o "$hook_object"
    "$toolchain/arm-none-eabi-ld" -r "$hook_object" -o "$hook_elf"
    java -cp "$rpm_tool" rpm.cli.RPMTool \
        -i "$hook_elf" \
        --fourcc DLXF \
        -o "$output" \
        --esdb "$symbol_db" \
        --meta "$script_dir/metadata_${game_lower}.yml" \
        --generate-relocations
}

build_one b2 B2 "$script_dir/symbols_b2.yml"
build_one w2 W2 "$w2_symbol_db"
