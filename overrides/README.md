# Verified per-version additions

Place independently verified additions in `<version>.json`, using project packet
names and opcode values, e.g. `{ "ExamplePacket": "0x0123" }` (illustrative only).
Register the packet's category in `packets.yaml` first. Do not copy old opcode
values without verification. Overrides cannot contradict the pinned community
mapping or introduce same-category collisions. These files are never downloaded
from the spreadsheet. Historical JSON remains the baseline for the next migration.
