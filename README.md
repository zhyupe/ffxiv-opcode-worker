# ffxiv-opcode-worker

This repository contains workflows that generate opcode files for different purposes

## Generate a new version from binary opcode differences

Requires Node.js 20 or newer. `npm run json` now uses
[xivdev/opcodediff](https://github.com/xivdev/opcodediff), cross-checked against
[FFXIVOpcodes](https://github.com/karashiiro/FFXIVOpcodes). It does not download or
replace `cn-opcodes.csv`. Both locally added packet names and historical JSON are
preserved; old opcode numbers are never copied blindly into the new version.

```sh
npm run json -- --dry-run
npm run json
```

Before each release, update `opcode-source.json` with:

- `previousVersion`: this repository's existing baseline JSON (e.g. `7.56a`).
- `sourceVersion`: opcodediff's old Global version (e.g. `7.56h`).
- `version`: the new release (e.g. `7.57`).
- `diffRef`, `oldUpstreamRef`, `newUpstreamRef`: immutable 40-character commit SHAs.
- `region`: reference table (Global by default); `sharedRegions`: Zone tables
  that must agree with it (CN and KR).

The generator verifies the diff's predecessor using opcodediff's version catalog.
It checks all old local values shared with the old reference and requires at least
20 server and 5 client baseline anchors. It independently compares diff results
against the new reference, requiring at least 20 server and 5 client matches and
zero disagreements. Missing diff entries may use the new reference directly.
Extra Zone packets use only one-to-one diff mappings. Splits/merges, unknown
categories and missing non-Zone mappings require review. Lobby/Chat values come
only from the configured new regional reference or explicit overrides; shared
Zone tables do not establish cross-region Lobby compatibility.

Verified manual additions belong in `overrides/<version>.json`, with categories
registered in `packets.yaml`. They must not contradict the new community table or
collide within an IPC category. `InventoryHandlerOffset` is derived from the
verified `InventoryModifyHandler` value, not treated as a separate packet.

The output is `json/<version>.json`, `json/current.json`, `json/version.json`, plus
`reports/<version>.json` recording fixed source revisions, build strings, checks
and per-packet provenance. Historical files are untouched. Unresolved entries are
shown by `--dry-run`; normal generation refuses to publish them. Network errors,
wrong baselines and conflicts fail before outputs are written. Existing target
additions must be represented in overrides before regeneration can remove them.
The Update opcodes workflow runs tests and this generator; no spreadsheet secret
is required.

### Validated transition: 7.56a → 7.57

The local baseline agrees with Global 7.56h (`2026.09.15.0000.0000`). The new
Global, CN and KR Zone tables agree. All 170 known server mappings and 10 client
mappings match opcodediff; ChatHandler and SetSearchInfoHandler are absent from
the diff and use the new community table. The old CN reference misnames an
EventPlay variant, so it is not used as the old baseline. New build:
`2026.10.06.0000.0000`. Extra migrated packet identities remain binary-diff
inferences, not a claim of live packet or payload-layout validation.

## Legacy CSV and name mapping

The spreadsheet is an optional legacy source. `npm run json:csv [input.csv]
[output-dir]` runs the old CSV generator; it refuses to roll the latest published
version back to an older CSV. Use a separate output directory when rebuilding
old spreadsheet data. Its optional community merge still uses the historical
50% conflict heuristic described below; the new binary-diff generator does not.

Both generation and historical backfill load the repository's `packets.yaml` at
runtime. Top-level keys follow the six IPC categories in
[FFXIVOpcodes/Ipcs.cs](https://github.com/karashiiro/FFXIVOpcodes/blob/master/FFXIVOpcodes/Ipcs.cs),
without the `Type` suffix: `ServerZoneIpc`, `ClientZoneIpc`, `ServerLobbyIpc`,
`ClientLobbyIpc`, `ServerChatIpc`, and `ClientChatIpc`. Each category declares its
`direction` (`server-to-client` or `client-to-server`) and a `packets` mapping:

```yaml
ServerZoneIpc:
  direction: server-to-client
  packets:
    ActorCast:
      ACT: ActorCast
    CompanyAirshipStatus:
      FFXIVOpcodes: AirshipTimers
ClientZoneIpc:
  direction: client-to-server
  packets:
    ActionRequest: {}
```

Packet keys are project names; their values retain the `FFXIVOpcodes`, `ACT`,
and `OverlayPlugin` name mappings. Use `{}` for packets without aliases and for empty
category packet lists. Known categories come from FFXIVOpcodes and CSV `Scope`;
`UpdateParty` is confirmed by Sapphire's `ServerIpcs.h`. Unclassified historical
CSV entries are omitted, so consumers leave their direction unspecified.

Only `FFXIVOpcodes` aliases participate in opcode merging. Incoming names are
translated before comparison and only project names are written for mapped
packets. Names without a mapping retain their spelling. Metadata stays in YAML;
the opcode JSON format remains unchanged. Direction is read directly from YAML;
it is not inferred from the category name. Categories are defined by the YAML
file and are not restricted to a built-in list. Use `--packets <path>` to load another
catalog; the default path is relative to the project. Missing or invalid catalogs,
duplicate YAML keys, invalid direction values, duplicate packet names
across categories, and ambiguous aliases abort without writing output. Packet
names must be unique across categories because the output JSON uses a flat map.

Opcodes are compared numerically after name mapping; hexadecimal case and padding do not matter.
The entire upstream merge is rejected when **50% or more** of the distinct
overlapping names conflict (conflicting names divided by overlapping names).
Below that threshold, new names are added and existing local values win every
conflict, with CSV values taking precedence during generation. New names do not
affect the conflict rate. No overlap, malformed data (including inconsistent
duplicate names across upstream lists), or a download failure also skips the
merge with a warning. Version labels need not match. New values use `0x`
followed by four uppercase hexadecimal digits.

Existing per-version JSON entries are retained and their known upstream aliases
are normalized, including entries in historical versions. Where both names
already exist, the project-name value wins. CSV values then take precedence,
including when a CSV name itself needs mapping. Only the latest version fetches
upstream data; `current.json` mirrors that version. Alias cleanup still happens
when the upstream merge is skipped. The output directory is not deleted.

## Backfill a historical version

Choose a commit SHA or tag from the upstream repository's history containing
the desired opcodes, then run:

```sh
npm run json:merge-history <target-version> <upstream-commit-or-tag> [output-dir] --dry-run
npm run json:merge-history <target-version> <upstream-commit-or-tag> [output-dir]
```

The target must already exist in `version.json` and have its own JSON file.
The tool defaults to Global and supports `--region CN`. It reads `opcodes.json`
at the specified Git revision and applies the same 50% conflict threshold,
preserving existing target JSON values on accepted conflicts. Reaching the
threshold or a download error exits with a nonzero status without writing
any files. `--dry-run` validates and reports additions and conflicts without
writing. Backfilling the latest version also updates `current.json`; backfilling
an older version leaves `current.json` alone. Subsequent binary-diff generations leave historical files untouched.

Run the regression tests with `npm run test`.
