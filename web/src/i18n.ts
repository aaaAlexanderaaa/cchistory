import type { EntryType, MessageRole, Mode } from "./types";

export type Language = "en" | "zh-CN";

export const LANGUAGE_STORAGE_KEY = "cchistory-language";

type EntryFilterOption = EntryType | "all";
type ToolStage = "call" | "result";

export interface UiCopy {
  language: {
    label: string;
    options: Record<Language, string>;
  };
  sidebar: {
    eyebrow: string;
    title: string;
    description: string;
    overview: string;
    sources: string;
    projects: string;
    filters: string;
    modes: string;
    sourceSection: string;
    projectSection: string;
    reset: string;
    allSources: string;
    indexed: string;
    allProjects: string;
    scopes: string;
    scopedProjectsHint: string;
    emptyProjects: string;
    footer: string;
  };
  main: {
    visibleItems: string;
    indexedEntries: string;
    activeFilters: string;
  };
  filters: {
    source: string;
    project: string;
    query: string;
    type: string;
    clearAll: string;
    noFilters: string;
  };
  search: {
    ariaLabel: string;
    placeholder: string;
    submit: string;
    submitting: string;
    clear: string;
    helper: string;
  };
  history: {
    loading: string;
    emptyExplore: string;
    emptySearch: string;
    loadMore: string;
    loadingMore: string;
  };
  conversation: {
    loading: string;
    empty: string;
    back: string;
    origin: string;
    metadata: string;
    termination: string;
    collapse: string;
    expand: string;
    promptTemplate: string;
    emptyMessage: string;
    roleLabels: Record<MessageRole, string>;
    toolStages: Record<ToolStage, string>;
    messageKinds: Record<string, string>;
    terminationReasons: Record<string, string>;
  };
  messageTemplates: {
    title: string;
    description: string;
    add: string;
    reset: string;
    remove: string;
    enabled: string;
    name: string;
    matchText: string;
    summary: string;
    scope: string;
    scopes: Record<"all" | MessageRole, string>;
  };
  distill: {
    loading: string;
    retry: string;
    empty: string;
    generate: string;
    artifact: string;
    refresh: string;
    patterns: string;
    decisions: string;
    openQuestions: string;
    provenance: string;
    nothingExtracted: string;
  };
  modeLabels: Record<Mode, string>;
  modeCaptions: Record<Mode, string>;
  modeTitles: Record<Mode, string>;
  modeDescriptions: Record<Mode, string>;
  entryTypes: Record<EntryFilterOption, string>;
  statusLabels: Record<string, string>;
}

const translations: Record<Language, UiCopy> = {
  en: {
    language: {
      label: "Language",
      options: {
        en: "EN",
        "zh-CN": "中文",
      },
    },
    sidebar: {
      eyebrow: "CCHistory",
      title: "History cockpit",
      description:
        "Review indexed sessions, search recall faster, and distill reusable notes without losing provenance.",
      overview: "Overview",
      sources: "Sources",
      projects: "Projects",
      filters: "Filters",
      modes: "Views",
      sourceSection: "Sources",
      projectSection: "Projects",
      reset: "Reset",
      allSources: "All sources",
      indexed: "indexed",
      allProjects: "All projects",
      scopes: "scopes",
      scopedProjectsHint: "Showing projects from the selected source.",
      emptyProjects: "No projects match the current source filter.",
      footer:
        "The list stays lightweight. Full detail opens on selection, and distill results link back to the source entries.",
    },
    main: {
      visibleItems: "Visible items",
      indexedEntries: "Indexed entries",
      activeFilters: "Active filters",
    },
    filters: {
      source: "Source",
      project: "Project",
      query: "Query",
      type: "Type",
      clearAll: "Clear all",
      noFilters: "No filters applied.",
    },
    search: {
      ariaLabel: "Search indexed history",
      placeholder: "Search snippets, titles, and history content",
      submit: "Search",
      submitting: "Searching...",
      clear: "Clear",
      helper: "Combine source, project, and type filters to narrow recall faster.",
    },
    history: {
      loading: "Loading indexed history...",
      emptyExplore: "No indexed entries matched the current timeline filters.",
      emptySearch: "No ranked search results matched the current filters.",
      loadMore: "Load more from the timeline",
      loadingMore: "Loading more...",
    },
    conversation: {
      loading: "Loading full entry detail...",
      empty: "Select an entry to load its full detail and provenance.",
      back: "Back to list",
      origin: "Origin",
      metadata: "Metadata",
      termination: "Ended by",
      collapse: "Collapse",
      expand: "Expand",
      promptTemplate: "Template",
      emptyMessage: "(empty)",
      roleLabels: {
        user: "User",
        assistant: "Assistant",
        system: "System",
        tool: "Tool",
      },
      toolStages: {
        call: "Call",
        result: "Result",
      },
      messageKinds: {
        prompt_injection: "Injected wrapper",
        continuation_summary: "Continuation summary",
        request_interruption: "Interrupted request",
        system_event: "System event",
        compact_boundary: "Context compaction",
        api_error: "API error",
      },
      terminationReasons: {
        tool_use: "Tool use",
        stop_sequence: "Completed",
        context_compacted: "Context compacted",
        user_interrupted: "Interrupted by user",
        user_interrupted_for_tool_use: "Interrupted for tool use",
        api_error: "API error",
      },
    },
    messageTemplates: {
      title: "Display templates",
      description:
        "Shorten known prompt-injection wrappers and continuation summaries in collapsed transcript previews.",
      add: "Add template",
      reset: "Reset defaults",
      remove: "Remove",
      enabled: "Enabled",
      name: "Name",
      matchText: "Match text",
      summary: "Collapsed label",
      scope: "Scope",
      scopes: {
        all: "All",
        user: "User",
        assistant: "Assistant",
        system: "System",
        tool: "Tool",
      },
    },
    distill: {
      loading: "Generating distill artifact...",
      retry: "Retry distill",
      empty: "No distill artifact is available for the current filters.",
      generate: "Generate distill",
      artifact: "Distill artifact",
      refresh: "Refresh",
      patterns: "Patterns",
      decisions: "Decisions",
      openQuestions: "Open questions",
      provenance: "Provenance",
      nothingExtracted: "Nothing extracted yet.",
    },
    modeLabels: {
      explore: "Explore",
      search: "Search",
      distill: "Distill",
    },
    modeCaptions: {
      explore: "Cursor timeline",
      search: "Ranked snippets",
      distill: "Patterns and decisions",
    },
    modeTitles: {
      explore: "Browse the indexed timeline",
      search: "Search ranked history recall",
      distill: "Distill recurring work into reusable notes",
    },
    modeDescriptions: {
      explore:
        "Scan the timeline by source or project, then open only the detail that matters. The layout keeps context, filters, and detail visible without feeling crowded.",
      search:
        "Search the history index with focused filters for source, project, and entry type. Results stay readable, and the selected detail opens without disrupting your place.",
      distill:
        "Generate reusable notes from the current slice, including patterns, decisions, open questions, and linked provenance entries.",
    },
    entryTypes: {
      all: "All types",
      conversation: "Conversation",
      visit: "Visit",
      message: "Message",
    },
    statusLabels: {
      ok: "ok",
      connected: "connected",
      degraded: "degraded",
      disabled: "disabled",
      failed: "failed",
      error: "error",
    },
  },
  "zh-CN": {
    language: {
      label: "语言",
      options: {
        en: "EN",
        "zh-CN": "中文",
      },
    },
    sidebar: {
      eyebrow: "CCHistory",
      title: "历史驾驶舱",
      description:
        "集中查看已索引会话、快速检索历史召回，并在保留出处的前提下提炼可复用笔记。",
      overview: "概览",
      sources: "数据源",
      projects: "项目",
      filters: "筛选",
      modes: "视图",
      sourceSection: "来源",
      projectSection: "项目",
      reset: "重置",
      allSources: "全部来源",
      indexed: "已索引",
      allProjects: "全部项目",
      scopes: "范围",
      scopedProjectsHint: "仅显示当前来源下的项目。",
      emptyProjects: "当前来源筛选下没有项目。",
      footer:
        "列表保持轻量摘要；选中后再加载完整细节，提炼结果也会回链到原始条目。",
    },
    main: {
      visibleItems: "当前结果",
      indexedEntries: "索引条目",
      activeFilters: "已启用筛选",
    },
    filters: {
      source: "来源",
      project: "项目",
      query: "查询",
      type: "类型",
      clearAll: "清除全部",
      noFilters: "当前未启用筛选。",
    },
    search: {
      ariaLabel: "搜索已索引历史",
      placeholder: "搜索片段、标题和历史内容",
      submit: "搜索",
      submitting: "搜索中...",
      clear: "清空",
      helper: "可组合来源、项目和类型筛选，更快缩小召回范围。",
    },
    history: {
      loading: "正在加载已索引历史...",
      emptyExplore: "当前时间线筛选下没有匹配的条目。",
      emptySearch: "当前筛选下没有匹配的搜索结果。",
      loadMore: "加载更多时间线条目",
      loadingMore: "加载中...",
    },
    conversation: {
      loading: "正在加载完整条目...",
      empty: "选择一条记录以查看完整细节与出处。",
      back: "返回列表",
      origin: "原始来源",
      metadata: "元数据",
      termination: "结束原因",
      collapse: "折叠",
      expand: "展开",
      promptTemplate: "模板",
      emptyMessage: "(空)",
      roleLabels: {
        user: "用户",
        assistant: "助手",
        system: "系统",
        tool: "工具",
      },
      toolStages: {
        call: "调用",
        result: "结果",
      },
      messageKinds: {
        prompt_injection: "注入包装",
        continuation_summary: "续接摘要",
        request_interruption: "中断请求",
        system_event: "系统事件",
        compact_boundary: "上下文压缩",
        api_error: "接口错误",
      },
      terminationReasons: {
        tool_use: "调用工具",
        stop_sequence: "正常完成",
        context_compacted: "上下文压缩",
        user_interrupted: "用户中断",
        user_interrupted_for_tool_use: "为工具调用而中断",
        api_error: "接口错误",
      },
    },
    messageTemplates: {
      title: "显示模板",
      description: "为已知的提示注入包装和续接摘要设置简化预览标签。",
      add: "新增模板",
      reset: "恢复默认",
      remove: "删除",
      enabled: "启用",
      name: "名称",
      matchText: "匹配文本",
      summary: "折叠标签",
      scope: "作用范围",
      scopes: {
        all: "全部",
        user: "用户",
        assistant: "助手",
        system: "系统",
        tool: "工具",
      },
    },
    distill: {
      loading: "正在生成提炼结果...",
      retry: "重试提炼",
      empty: "当前筛选条件下暂无提炼结果。",
      generate: "生成提炼",
      artifact: "提炼结果",
      refresh: "刷新",
      patterns: "模式",
      decisions: "决策",
      openQuestions: "待解决问题",
      provenance: "出处",
      nothingExtracted: "暂未提取内容。",
    },
    modeLabels: {
      explore: "浏览",
      search: "搜索",
      distill: "提炼",
    },
    modeCaptions: {
      explore: "时间线",
      search: "排序片段",
      distill: "模式与决策",
    },
    modeTitles: {
      explore: "浏览已索引时间线",
      search: "搜索历史召回",
      distill: "提炼可复用结论",
    },
    modeDescriptions: {
      explore:
        "按来源或项目筛选时间线，专注浏览当前上下文。需要时再展开完整细节，减少视觉负担。",
      search:
        "使用来源、项目和条目类型组合筛选，更快定位关键片段，同时保持结果列表和详情联动清晰。",
      distill:
        "基于当前筛选范围生成模式、决策、待解决问题和出处条目，便于复盘与复用。",
    },
    entryTypes: {
      all: "全部类型",
      conversation: "对话",
      visit: "访问",
      message: "消息",
    },
    statusLabels: {
      ok: "正常",
      connected: "已连接",
      degraded: "性能下降",
      disabled: "已停用",
      failed: "失败",
      error: "错误",
    },
  },
};

export function detectInitialLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "en" || stored === "zh-CN") {
    return stored;
  }

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getCopy(language: Language): UiCopy {
  return translations[language];
}

export function getLocale(language: Language): string {
  return language === "zh-CN" ? "zh-CN" : "en-US";
}
