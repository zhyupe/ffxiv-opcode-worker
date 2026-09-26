# ffxiv-opcode-worker

This repository contains workflows that generate opcode files for different purposes

## About the opcodes

存储 opcode 的文件 (cn-opcodes.csv) 是 Google Docs 上一个电子表格的镜像。所有修改都应当在原始文件上进行，请不要向
该文件提交 PR。

如果您认为某个**当前版本**的 opcode 是错误的，或者想要更新对应的 WireShark 过滤器，请提交 Issue 并提供 Wireshark
的截图（如果 opcode 是通过字节码发现的，请提供 IDA 截图）。请记得抹去截图中如 ID、昵称、账号等敏感信息。由于过期的
opcode 没有实际用途，历史版本及已公告更新时间的版本将不再接受修正。相关历史版本的 opcode 可能被移除。

The opcodes file (cn-opcodes.csv) is a mirror to a spreadsheet on Google Docs. So any PR to the csv file
will be closed as they should be updated in the original file.

If you think any opcode is incorrect in **CURRENT GAME VERSION** or want to update WireShark filters,
please open an issue. Screenshots of Wireshark (or IDA if you discovered an opcode from bytecode) are
required. Please remember to erase any sensitive data like your ID, nickname, account, etc. Corrections
would not be accepted if the correlated game version expired or a new patch is scheduled since old opcodes
are actually useless and may be removed any time.

## Generate and merge JSON

Requires Node.js 20 or newer. Run `npm run json [input.csv] [output-dir]` (defaults:
`cn-opcodes.csv` and `json`). The latest CSV version is supplemented at runtime
with the **Global** entry from
[FFXIVOpcodes/opcodes.json](https://github.com/karashiiro/FFXIVOpcodes/blob/master/opcodes.json).
Use `--region CN` to select another region.

Opcodes are compared numerically; hexadecimal case and padding do not matter.
The entire upstream merge is rejected when **50% or more** of the distinct
overlapping names conflict (conflicting names divided by overlapping names).
Below that threshold, new names are added and existing local values win every
conflict, with CSV values taking precedence during generation. New names do not
affect the conflict rate. No overlap, malformed data (including inconsistent
duplicate names across upstream lists), or a download failure also skips the
merge with a warning. Version labels need not match. New values use `0x`
followed by four uppercase hexadecimal digits.

Existing per-version JSON entries are retained, including previously merged
entries in historical versions. CSV values take precedence for names present in
the CSV. Only the latest version fetches upstream data; `current.json` mirrors
that version. The output directory is no longer deleted before generation.

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
an older version leaves `current.json` alone. Subsequent `npm run json` runs retain
the backfilled entries.

Run the regression tests with `npm run test`.
