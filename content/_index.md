---
title: 首页
---

![](https://s2.loli.net/2022/03/17/EemiTDZlXO9SvfP.png)

根据《中华人民共和国著作权法》第五条，本作品不适用于该法。如不受其他法律、法规保护，本作品在中国大陆和其他地区属于公有领域。不适用于《中华人民共和国著作权法》的作品包括：
- （一）法律、法规，国家机关的决议、决定、命令和其他具有立法、行政、司法性质的文件，及其官方正式译文；
- （二）单纯事实消息；
- （三）历法、通用数表、通用表格和公式。

法律内容来源于[国家法律法规数据库](https://flk.npc.gov.cn)，该项目仅做整合和搜索等功能，如果您在使用过程中发现部分法条有误，或不完整，请联系开发者进行修改。


![Swift](https://img.shields.io/badge/swift-F54A2A?style=for-the-badge&logo=swift&logoColor=white)
[![App Store](https://img.shields.io/badge/App_Store-0D96F6?style=for-the-badge&logo=app-store&logoColor=white)](https://apps.apple.com/app/apple-store/id1612953870?pt=124208302&ct=github&mt=8)

# 收录信息
 - 法律: 394 部 [^1]
 - 司法解释: 389 部
 - 行政法规: 620 部
 - 地方性法规
	- 浙江: 410 部
	- 河南: 418 部
	- 山东: 472 部
	- 北京: 165 部
	- 上海: 206 部
 - 部门规章
	- 市场监督管理总局: 17 部
	- 国家安全部: 1 部
	- 公安部: 9 部
 - 更新时间: Sat Jul 23 03:08:09 UTC 2022

# 项目工作流程

{{< mermaid>}}
graph LR
    A[Laws] --> B[CI/CD]
    A --> G[Sub module]
    G --> H[iOS 版本]
    G --> I[Android 版本]
    B --> E[Web 版本]
{{< /mermaid >}}

提交法律法规到 [Laws](https://github.com/LawRefBook/Laws/tree/master), 会自动触发 Github Actions 更新该网页版本。同时，[iOS Repo](https://github.com/RanKKI/LawRefBook) 使用了 Git Module 的形式，所以打包的时候会自动拉取所有法律法规。

[^1]: 因为排版问题，民法典算七部法律，即五个分编加总则和附则