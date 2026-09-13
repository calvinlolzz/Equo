# CLAUDE.md

## 工作分工（2026-09-14 定案）

實作任務照這個分工，不要單一模型從頭包到尾：

- **詳細規劃、審查代碼** — Opus（max effort）。開工前先把改動範圍、要動的檔案、風險點列清楚；代碼寫完後逐一過一遍，不是掃過去。
- **寫代碼** — Sonnet 5（high effort）。照 Opus 的規劃寫，寫完換 Opus 審。

流程是 **Opus 規劃 → Sonnet 寫 → Opus 審 → 視情況回 Sonnet 修**，不要跳過規劃或審查兩端直接讓 Sonnet 全包。規劃與審查用 Agent 工具的 `model: "opus"`（必要時疊加高 reasoning effort）；不要為了省一次 Agent 呼叫就用 Sonnet 自己規劃或自己審自己的代碼。

其餘沒有特別要求分工的雜項（跑測試、查資料、寫 commit message 等）不受此限制。
