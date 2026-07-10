# Mode: China JD Pipeline

本模式用于处理中国互联网实习岗位 JD，目标流程为：

```text
jds/pending/*.md
-> 中文 JD 分析
-> reports/*.md
-> tracker 记录
```

## Scope

本模式只处理用户已经复制并保存到本地的 JD Markdown 文件。

本阶段不要执行：

- BOSS 直聘自动抓取
- 牛客自动抓取
- 拉勾自动抓取
- 批量扫描招聘平台
- Web UI 操作
- 原有 Node 脚本重构

## Required Context

执行中国 JD Pipeline 时，必须加载以下文件，并将它们作为唯一有效上下文：

- `modes/zh/_shared.md`
- `modes/_profile.md`
- `config/profile.yml`
- `cv.md`
- `modes/zh/oferta.md`
- `modes/contacto.md`

必须优先使用 `cv.md`、`config/profile.yml`、`modes/_profile.md` 中已经存在的信息。不得编造候选人经历、项目、技能熟练度或求职偏好。

## Forbidden Context

本模式禁止使用以下英文默认评估文件：

- `modes/_shared.md`
- `modes/oferta.md`

如果执行环境默认读取上述文件，必须停止并提示需要切换到中文 Pipeline 上下文。

## Input

输入来源为 `jds/pending/*.md` 或用户指定的本地 JD 文件。

推荐 JD 文件使用 `templates/jd-input-template.md` 的结构：

- 公司
- 岗位
- 城市
- 招聘平台
- JD 链接
- 发布时间
- 实习条件
- 岗位描述
- 岗位要求
- 备注

如果某些字段为空，可以标记为“未提供”，不要自行推断。

## Output Language

所有输出必须使用中文。

## Scoring

评分必须使用 0-100 分制。

必须输出：

- 综合评分
- 分项评分

分项评分必须包含：

- 技术匹配：/40
- 项目匹配：/25
- 岗位质量：/15
- 成长空间：/10
- 城市/实习条件：/10

每个分项都必须说明原因。

## Required Analysis Sections

每个 JD 分析报告必须包含：

1. 岗位基本信息
2. 技术要求分析
3. 技能匹配置信度
4. 综合评分
5. 分项评分
6. 匹配优势
7. 技术短板
8. 风险判断
9. 推荐简历版本
10. 投递建议
11. 沟通策略
12. 预计面试问题

## Skill Match Confidence

技能匹配置信度必须拆分为：

- 明确匹配
- 相关匹配
- 未知缺失

禁止把“相关匹配”直接等同于“明确匹配”。

示例：

- `Spring Boot` 出现在 `cv.md` 中，可以作为明确匹配。
- `FastAPI` 可以说明有 Python Web/API 相关经验，但不能等同于熟练所有 Python 后端生态。
- `Kafka` 如果没有出现在 `cv.md` 中，应标记为未知缺失。

## Resume Version

推荐简历版本只能选择：

- Java后端版
- AI应用版
- 全栈版
- 无推荐简历版本

如果投递建议为“不推荐”，推荐简历版本必须为“无推荐简历版本”。

## Application Decision

投递建议只能选择：

- 推荐投递
- 谨慎投递
- 不推荐

决策规则：

- 推荐投递：生成正常 BOSS/牛客/拉勾开场白。
- 谨慎投递：生成岗位详情确认话术，重点确认技术栈、实习内容、导师指导、到岗时间和实习周期。
- 不推荐：不要生成正常求职话术；只生成岗位真实性确认问题。

## Communication Strategy

沟通策略必须参考 `modes/contacto.md`。

如果岗位来自 BOSS 直聘，输出标题使用“BOSS沟通开场白”或“岗位真实性确认问题”。

如果岗位来自牛客或拉勾，输出标题使用对应平台名称。

沟通内容应符合：

- 学生身份
- 技术真实
- 简洁
- 100-150 字优先
- 不使用架构师、专家、负责人、多年经验等高级岗位表达

## Tracker Intent

分析完成后，应为 tracker 记录准备以下字段：

- 公司
- 岗位
- 城市
- 招聘平台
- JD链接
- 匹配评分
- 推荐简历版本
- 投递状态
- 联系人
- 最近沟通时间
- 下一步动作
- 报告路径

状态应优先使用中国实习流程状态：

- `discovered`
- `evaluating`
- `recommended`
- `contacted`
- `hr_viewed`
- `applied`
- `screening`
- `test`
- `interview1`
- `interview2`
- `offer`
- `rejected`
- `withdrawn`

如果当前脚本层不支持这些状态，不要绕过；应报告兼容问题并等待脚本层修复。

## Report Saving

报告应保存到 `reports/`，文件名建议：

```text
{编号}-{company-slug}-{YYYY-MM-DD}.md
```

报告正文必须保留完整中文分析结果，方便后续用于：

- JD 匹配复盘
- 简历版本选择
- 面试准备
- 投递跟踪
- 沟通话术复用

