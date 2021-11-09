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
