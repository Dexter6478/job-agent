# Mode: pdf -- 中国实习简历生成

本模式用于根据 JD 生成适合中国互联网实习投递的中文简历版本。

只生成基于 `cv.md` 的内容。不要编造经历、实习、竞赛、证书、量化指标或高级岗位能力。

---

## 输入

必须读取：
- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- 当前 JD 或岗位分析报告

如果没有 JD，先向用户索要 JD 文本、岗位链接或本地 JD 文件。

---

## 支持的简历版本

只能选择以下三个版本之一：

### 1. Java后端版

突出：
- Java
- Spring Boot
- Spring MVC
- RESTful API
- MySQL
- PostgreSQL
- Redis
- 事务
- 行级锁
- 项目开发

重点项目：
- 图书管理系统
- Dietapp 中的 Redis、PostgreSQL、接口、日志指标等后端内容

适用 JD：
- Java后端开发实习
- 后端开发实习
- Spring Boot 实习
- 服务端开发实习

### 2. AI应用版

突出：
- LLM
- LLM API
- Prompt Engineering
- RAG
- Agent
- FastAPI
- PostgreSQL
- Redis
- AI安全
- Prompt Injection

重点项目：
- 智能饮食健康管理系统 Dietapp

适用 JD：
- AI应用开发实习
- 大模型应用开发实习
- RAG应用开发实习
- Agent开发实习
- Python/FastAPI + AI 应用岗位

### 3. 全栈版

突出：
- Vue3
- React Native
- TypeScript
- Expo
- 前后端分离
- 接口联调
- Spring Boot / FastAPI 后端配合

重点项目：
- 图书管理系统
- Dietapp

适用 JD：
- 全栈开发实习
- 前后端开发实习
- 管理后台开发实习
- 移动端/前后端联调相关实习

---

## 版本选择规则

从 JD 中提取关键词：

- 如果 JD 主要是 Java、Spring Boot、MySQL、Redis、RESTful API：选择 **Java后端版**。
- 如果 JD 主要是 LLM、RAG、Agent、Prompt、AI安全、FastAPI：选择 **AI应用版**。
- 如果 JD 主要是 Vue3、React Native、TypeScript、前后端分离：选择 **全栈版**。

如果 JD 同时包含多个方向，选择最贴近岗位主要职责的版本，并在输出中说明取舍。

---

## 内容生成规则

### 个人总结

写成本科实习生定位：

```text
软件工程本科在读，目标方向为 Java 后端开发实习 / AI 应用开发实习。具备前后端分离项目经验，熟悉 Java、Spring Boot、数据库基础和 Redis 应用，了解 LLM API、RAG、Agent 与 AI 安全相关开发。
```

根据简历版本调整关键词，但必须真实。

### 技能区

按版本排序：

Java后端版：
1. Backend
2. Database
3. Cache
4. Frontend
5. AI
6. Tools

AI应用版：
1. AI
2. Backend
3. Database
4. Cache
5. Frontend
6. Tools

全栈版：
1. Backend
2. Frontend
3. Database
4. Cache
5. AI
6. Tools

### 项目经历

必须保留项目真实性。

每个项目输出：
- 项目名称
- 时间
- 角色
- 技术栈
- 核心功能
- 技术亮点
- 个人贡献

项目排序：
- Java后端版：图书管理系统优先，Dietapp 次之。
- AI应用版：Dietapp 优先，图书管理系统次之。
- 全栈版：两个项目都保留，突出前后端联调。

---

## 禁止表达

不要生成高级岗位语言，禁止使用：
- 架构师
- 专家
- 负责人
- 多年经验
- 企业级架构
- 技术战略
- 赋能
- 闭环
- 全链路负责人

可以使用：
- 参与
- 负责
- 实现
- 了解
- 熟悉
- 掌握基础
- 项目中使用
- 前后端联调
- 数据库表设计

---

## 中国实习简历格式

推荐一页中文简历结构：

1. 基本信息
2. 求职方向
3. 教育背景
4. 技术技能
5. 项目经历
6. 自我评价

不要默认加入英文 LinkedIn/portfolio。只有 `config/profile.yml` 中存在时才加入。

照片：
- 不主动加入照片。
- 如果用户明确要求或模板已有照片，再按用户要求处理。

---

## PDF 生成流程

1. 读取 `cv.md`。
2. 读取 `config/profile.yml`。
3. 读取 JD 或报告。
4. 选择简历版本：Java后端版 / AI应用版 / 全栈版。
5. 提取 JD 关键词，但只注入候选人真实具备或了解的关键词。
6. 生成 HTML 到 `output/`。
7. 使用现有命令生成 PDF：

```bash
node generate-pdf.mjs output/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --format=a4
```

如果该岗位已有报告编号，传入 `--report={report number}`。

---

## 输出

完成后输出：
- 选择的简历版本
- PDF 路径
- HTML 路径
- 使用的 JD 关键词
- 未覆盖的 JD 要求
- 是否需要生成 BOSS/牛客/拉勾沟通话术

---

## 质量检查

生成前检查：
- 是否使用了 `cv.md` 中不存在的事实。
- 是否出现高级岗位语言。
- 是否符合本科实习定位。
- 是否能支撑面试追问。
- 是否包含 JD 中最重要的技术关键词。

发现不确定信息时，写“未提供”或询问用户，不要猜。
