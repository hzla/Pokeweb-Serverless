# Overworld weather graphics and bundles

White 2 area headers store weather in six bits. Pokeweb therefore exposes the
15 retail IDs (`0`–`14`) plus exactly 49 custom IDs (`15`–`63`). IDs `15`–`17`
name dormant source-era effects in an unmodified game, but the bundled
expansion deliberately owns the entire `15`–`63` range.

Never assign an ID above `14` without a compatible runtime. The retail
dispatcher has only 15 rows even though the saved header field is wider.

## One-time White 2 expansion

The Code Injection page installs `PokewebOverworldWeatherW2.dll` once. It
provides a resident 64-row dispatcher and reads the custom definitions from:

```text
weather/pwth.bin
```

The editor rewrites this registry when a graphical weather clone changes.
Cloning a second effect does not generate or install another DLL.

Each custom row chooses a retail donor ID (`0`–`14`) for callbacks and overlay
behavior, then overrides independently appended members in weather archive
`a/0/5/5`:

- NANR animation
- NCER cell
- NCGR character
- NCLR palette
- up to two auxiliary NSBTX screen-plane resources

Disabled or invalid rows resolve to Clear. Stock IDs remain direct copies of
the retail dispatcher rows.

## PWTH registry summary

`weather/pwth.bin` is little-endian and begins with the signature `PWTH`.
Its 16-byte header contains format version `1`, entry size `48`, first ID `15`,
and entry count `49`. The fixed-size rows then cover IDs `15` through `63` in
order. Resource index `0xFFFF` means "not used."

Rows store channel flags, donor ID, the four particle member indices, two
auxiliary member indices, particle density and movement multipliers, fog
intensity/color/slope/fade values, screen scroll speed, and reserved fields.
Multipliers are Q8.8; fog colors are RGB5. The exact byte offsets and runtime
validation rules are documented alongside the patch in
`White2Upgrade/OVERWORLD_WEATHER_RUNTIME.md`.

ABI 2 applies all six resource redirects. It also applies fog RGB, intensity,
slope, and fade timing for generic fog donors. Particle density, movement speed,
and screen-plane scroll values are currently previewed and preserved in the
registry but are not yet applied by the native donor callbacks.

## Graphics editor workflow

1. Open Code Injection and install the White 2 overworld weather expansion.
2. Open Weather Graphics and clone a retail effect into an available ID from
   `15` to `63`.
3. Pokeweb appends independent resources to `a/0/5/5` and writes that ID's
   `PWTH` row.
4. Adjust the supported runtime fields and preview controls.
5. Assign the custom ID from the Overworld Weather area editor.

Transitions between custom weather IDs use the game's normal teardown/init
lifecycle, including two clones that share the same donor.

## External `.pwwweather` bundles

Pokeweb also imports externally-authored effects from a `.pwwweather` ZIP with
`manifest.json` at its root. Pokeweb does not author custom callback code. A
bundle may provide editor preview assets, full NitroFS files, NARC operations,
and PMC modules for effects that cannot use the bundled donor registry.

Minimal manifest:

```json
{
  "format": "pokeweb-overworld-weather",
  "version": 1,
  "id": 18,
  "name": "Soft Fog",
  "baseVersions": ["W2"],
  "preview": {
    "behavior": "fog",
    "tint": "#9e7e82"
  },
  "runtime": {
    "external": true
  }
}
```

`"external": true` asserts that an already-installed runtime handles the ID.
The bundle author is responsible for keeping that claim accurate. A bundle can
instead carry DLXF modules:

```json
"runtime": {
  "modules": [
    { "file": "runtime/weather_w2.dll", "target": "patches" }
  ]
}
```

The module's `PMCGameID`, when present, must match the loaded ROM.

## Preview assets

A static editor image:

```json
"preview": {
  "image": "preview/snow.png",
  "behavior": "snow",
  "tint": "#c9ddec"
}
```

Or a Nitro OAM particle set:

```json
"preview": {
  "behavior": "snow",
  "particle": {
    "character": "preview/snow.NCGR",
    "palette": "preview/snow.NCLR",
    "cell": "preview/snow.NCER",
    "animation": "preview/snow.NANR"
  }
}
```

Supported preview behaviors are `clear`, `snow`, `rain`, `sand`, `hail`,
`diamond`, `fog`, and `mirage`. They drive Pokeweb's approximation, not native
game callbacks.

## Runtime files and NARC operations

Bundles can add or replace full NitroFS paths:

```json
"runtime": {
  "romFiles": [
    { "file": "runtime/weather_config.bin", "path": "weather/custom/config.bin" }
  ]
}
```

They can also replace or append NARC members:

```json
"runtime": {
  "narcFiles": [
    {
      "file": "runtime/snow.NCGR",
      "archivePath": "a/0/5/5",
      "operation": "append",
      "name": "custom_snow.NCGR"
    },
    {
      "file": "runtime/rain.NCLR",
      "archivePath": "a/0/5/5",
      "operation": "replace",
      "index": 14
    }
  ]
}
```

Bundle and ROM paths must be relative, contain no `..` component, and reference
files present in the ZIP. Appended registry resources use 16-bit indices:
`0xFFFE` is the theoretical maximum, `0xFFFF` is reserved, and every index must
be below the archive's actual member count.

The area editor changes the zone-header default. Moving-Pokémon areas,
facilities, scripts, birthdays, and calendar weather can still replace that
default through retail selection logic.
