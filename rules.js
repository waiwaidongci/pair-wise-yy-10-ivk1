/*
 * rules.js —— 业务规则层（纯逻辑，不依赖 DOM / localStorage）
 *
 * 核心规则：
 * 1. 客户改纹样、胎体或线条时新建变更单；旧确认单失效，作品停在「待复确认」。
 * 2. 每件作品同时只能有一份未确认变更；重复或并发请求沿用首次登记。
 * 3. 变更必须登记联系人、样稿版本、原因；缺项或版本不一致返回 409。
 * 4. 作品绑定当前样稿确认单后才能继续阴干与交付。
 * 5. 旧样稿版本留档只读；缺陷与流转记录只追加、不覆盖。
 */
(function (global) {
  "use strict";

  var LINE_TYPES = ["细线", "中线", "粗线", "混合线"];
  var GOLD_STATUSES = ["未处理", "试扫粉", "已上金粉"];
  var STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  var HOLD_STATUS = "待复确认";
  var ALL_STATUSES = STATUSES.concat(HOLD_STATUS);
  // 必须持有当前样稿确认单才能进入的工序
  var GATED_STATUSES = ["待阴干", "待交付"];

  var SPEC_LABELS = { theme: "纹样", base: "胎体", line: "线条" };

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function now() {
    return new Date().toLocaleString();
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function fail(status, message) {
    return { ok: false, status: status, message: message };
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function parseVersion(value) {
    if (value === null || value === undefined) return null;
    var match = String(value).trim().match(/^v?\s*(\d+)$/i);
    return match ? Number(match[1]) : null;
  }

  function specOf(work) {
    return { theme: work.theme, base: work.base, line: work.line };
  }

  function specDiff(from, to) {
    return Object.keys(SPEC_LABELS)
      .filter(function (key) {
        return from[key] !== to[key];
      })
      .map(function (key) {
        return SPEC_LABELS[key] + "：" + from[key] + " → " + to[key];
      })
      .join("；");
  }

  function pendingChange(work) {
    if (!work.pendingChangeId) return null;
    var found = null;
    work.history.forEach(function (entry) {
      if (entry.id === work.pendingChangeId) found = entry;
    });
    return found && found.status === "待复确认" ? found : null;
  }

  function hasCurrentConfirmation(work) {
    return !!work.confirmation && work.confirmation.version === work.sampleVersion;
  }

  /*
   * 新增作品：同时生成 v1 初次样稿确认单（需联系人），作品自创建起即绑定当前确认单。
   * 返回 { ok: true, work } 或 { ok: false, status, message }。
   */
  function createWork(input) {
    input = input || {};
    var base = trim(input.base);
    var theme = trim(input.theme);
    var line = trim(input.line);
    var contact = trim(input.contact);
    var note = trim(input.note);

    var missing = [];
    if (!base) missing.push("胎体材质");
    if (!theme) missing.push("纹样主题");
    if (LINE_TYPES.indexOf(line) === -1) missing.push("线条粗细");
    if (!contact) missing.push("联系人");
    if (!input.dryDate) missing.push("阴干日期");
    if (!input.delivery) missing.push("交付日期");
    if (missing.length) return fail(400, "新增作品缺项：" + missing.join("、"));

    var status = STATUSES.indexOf(input.status) !== -1 ? input.status : "贴线中";
    var gold = GOLD_STATUSES.indexOf(input.gold) !== -1 ? input.gold : "未处理";
    var progress = Math.max(0, Math.min(100, Number(input.progress) || 0));
    var at = now();
    var spec = { theme: theme, base: base, line: line };

    var initial = {
      id: uid(),
      kind: "初次确认",
      version: 1,
      contact: contact,
      reason: "初次样稿确认",
      spec: { theme: theme, base: base, line: line },
      status: "已确认",
      createdAt: at,
      confirmedAt: at
    };

    var work = {
      id: uid(),
      theme: theme,
      base: base,
      line: line,
      progress: progress,
      dryDate: input.dryDate,
      gold: gold,
      delivery: input.delivery,
      status: status,
      note: note,
      sampleVersion: 1,
      confirmation: {
        id: initial.id,
        version: 1,
        contact: contact,
        reason: initial.reason,
        spec: { theme: theme, base: base, line: line },
        confirmedAt: at
      },
      pendingChangeId: null,
      statusBeforeHold: null,
      defects: [],
      history: [initial],
      logs: [at + " 创建作品，样稿 v1 由 " + contact + " 确认"]
    };

    var initialDefect = trim(input.defect);
    if (initialDefect) addDefect(work, initialDefect);

    return { ok: true, work: work };
  }

  /*
   * 客户改样：登记变更单。
   * - 已有未确认变更：重复/并发请求沿用首次，返回 { ok: true, reused: true, change }。
   * - 联系人 / 样稿版本 / 原因缺项：409。
   * - 提交版本与当前样稿版本不一致：409（乐观并发控制）。
   * - 成功后旧确认失效，作品停在「待复确认」，旧样稿在 history 中原样留档。
   */
  function requestChange(work, input) {
    input = input || {};

    var existing = pendingChange(work);
    if (existing) {
      return { ok: true, reused: true, change: existing };
    }

    var contact = trim(input.contact);
    var reason = trim(input.reason);
    var rawVersion = input.version === undefined || input.version === null ? "" : String(input.version);
    if (!contact || !reason || !trim(rawVersion)) {
      return fail(409, "变更登记缺项：联系人、样稿版本、原因均为必填");
    }

    var submittedVersion = parseVersion(rawVersion);
    if (submittedVersion === null) {
      return fail(409, "样稿版本格式不正确，应为 v" + work.sampleVersion + " 这样的版本号");
    }
    if (submittedVersion !== work.sampleVersion) {
      return fail(
        409,
        "样稿版本不一致：当前已为 v" + work.sampleVersion + "，请刷新后按最新版本登记"
      );
    }

    var to = { theme: trim(input.theme), base: trim(input.base), line: trim(input.line) };
    if (!to.theme || !to.base || LINE_TYPES.indexOf(to.line) === -1) {
      return fail(400, "变更后的纹样、胎体、线条均须有效");
    }
    var from = specOf(work);
    if (to.theme === from.theme && to.base === from.base && to.line === from.line) {
      return fail(400, "纹样、胎体、线条均未变化，无需新建变更单");
    }

    var at = now();
    var change = {
      id: uid(),
      kind: "改样",
      fromVersion: work.sampleVersion,
      version: work.sampleVersion + 1,
      contact: contact,
      reason: reason,
      from: from,
      to: to,
      status: "待复确认",
      createdAt: at,
      confirmedAt: null
    };

    work.history.push(change);
    work.pendingChangeId = change.id;
    work.statusBeforeHold = work.status === HOLD_STATUS ? work.statusBeforeHold : work.status;
    work.confirmation = null; // 旧确认失效
    work.status = HOLD_STATUS;
    work.logs.push(
      at +
        " 客户改样（" +
        specDiff(from, to) +
        "），变更单 v" +
        change.version +
        " 待复确认，旧样稿 v" +
        change.fromVersion +
        " 留档只读"
    );

    return { ok: true, reused: false, change: change };
  }

  /*
   * 工坊复确认：确认唯一的待复确认变更单。
   * 确认后应用新样稿、版本号前进、绑定新确认单，作品恢复到挂起前工序。
   */
  function confirmChange(work, changeId) {
    var id = changeId || work.pendingChangeId;
    if (!id) return fail(409, "该作品没有待复确认的变更单");

    var change = null;
    work.history.forEach(function (entry) {
      if (entry.id === id) change = entry;
    });
    if (!change || change.kind !== "改样") return fail(409, "变更单不存在");
    if (work.pendingChangeId !== change.id) return fail(409, "该变更单不是当前未确认变更");
    if (change.status !== "待复确认") return fail(409, "变更单已确认，不能重复复确认");

    var at = now();
    change.status = "已确认";
    change.confirmedAt = at;

    work.theme = change.to.theme;
    work.base = change.to.base;
    work.line = change.to.line;
    work.sampleVersion = change.version;
    work.confirmation = {
      id: change.id,
      version: change.version,
      contact: change.contact,
      reason: change.reason,
      spec: { theme: change.to.theme, base: change.to.base, line: change.to.line },
      confirmedAt: at
    };
    work.pendingChangeId = null;
    work.status = work.statusBeforeHold || "贴线中";
    work.statusBeforeHold = null;
    work.logs.push(
      at +
        " 样稿 v" +
        change.version +
        " 复确认通过并绑定，作品恢复「" +
        work.status +
        "」"
    );

    return { ok: true, change: change };
  }

  /*
   * 工序流转：挂起期间禁止流转；进入阴干/交付必须持有当前样稿确认单。
   */
  function transition(work, nextStatus) {
    if (STATUSES.indexOf(nextStatus) === -1) {
      return fail(400, "未知工序状态：" + nextStatus);
    }
    if (pendingChange(work)) {
      return fail(
        409,
        "变更单待复确认，作品停在「" + HOLD_STATUS + "」，复确认前不能流转到「" + nextStatus + "」"
      );
    }
    if (GATED_STATUSES.indexOf(nextStatus) !== -1 && !hasCurrentConfirmation(work)) {
      return fail(409, "须绑定当前样稿确认单后，才能继续「" + nextStatus + "」");
    }

    var at = now();
    work.status = nextStatus;
    if (nextStatus === "待阴干") work.dryDate = today();
    if (nextStatus === "上金粉") work.gold = "已上金粉";
    if (nextStatus === "待交付") work.progress = 100;
    work.logs.push(at + " 流转：" + nextStatus);
    return { ok: true };
  }

  /*
   * 缺陷只追加，不覆盖既有缺陷记录。
   */
  function addDefect(work, text) {
    var value = trim(text);
    if (!value) return fail(400, "缺陷内容不能为空");
    var record = { id: uid(), text: value, at: now() };
    work.defects.push(record);
    work.logs.push(record.at + " 缺陷：" + value);
    return { ok: true, defect: record };
  }

  global.WorkshopRules = {
    LINE_TYPES: LINE_TYPES,
    GOLD_STATUSES: GOLD_STATUSES,
    STATUSES: STATUSES,
    HOLD_STATUS: HOLD_STATUS,
    ALL_STATUSES: ALL_STATUSES,
    GATED_STATUSES: GATED_STATUSES,
    today: today,
    parseVersion: parseVersion,
    specDiff: specDiff,
    pendingChange: pendingChange,
    hasCurrentConfirmation: hasCurrentConfirmation,
    createWork: createWork,
    requestChange: requestChange,
    confirmChange: confirmChange,
    transition: transition,
    addDefect: addDefect
  };
})(typeof window !== "undefined" ? window : this);
