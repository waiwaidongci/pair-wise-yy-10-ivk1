/*
 * rules.js —— 业务规则层（纯逻辑，不接触 DOM 与 localStorage）
 *
 * 核心规则：
 * 1. 作品必须绑定“已确认”的当前样稿确认单，才能继续阴干与交付；
 * 2. 改动纹样、胎体或线条必须新建变更单：旧确认失效，作品停在“待复确认”；
 * 3. 每件作品同时只能有一份未确认变更，重复/并发请求沿用首次登记；
 * 4. 变更单必须登记联系人、样稿版本、原因，缺项或版本不一致返回 409；
 * 5. 旧样稿版本留档只读，缺陷与流转记录只追加、不覆盖。
 */
(function () {
  "use strict";

  const FLOW_STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  const BLOCKED = "待复确认";
  const STATUSES = ["贴线中", BLOCKED, "待阴干", "上金粉", "待交付"];
  // 需要绑定有效样稿确认单才能进入的工序
  const GUARDED_STATUSES = ["待阴干", "待交付"];
  const SPEC_KEYS = ["base", "theme", "line"];

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2);
  }
  function now() { return new Date().toISOString(); }
  function nowText() { return new Date().toLocaleString("zh-CN", { hour12: false }); }

  function fail(status, message, extra) {
    return Object.assign({ ok: false, status: status, message: message }, extra || {});
  }
  function succeed(extra) {
    return Object.assign({ ok: true }, extra || {});
  }

  function pushLog(work, text) {
    work.logs.push({ id: uid(), at: now(), atText: nowText(), text: text });
  }
  function pushDefect(work, text) {
    work.defects.push({ id: uid(), at: now(), atText: nowText(), text: text });
  }

  function findWork(state, workId) {
    return state.works.find(function (w) { return w.id === workId; }) || null;
  }
  function currentConfirmation(state, work) {
    return state.confirmations.find(function (c) { return c.id === work.currentConfirmationId; }) || null;
  }
  function pendingChangeFor(state, workId) {
    return state.changes.find(function (c) { return c.workId === workId && c.status === BLOCKED; }) || null;
  }
  function parseVersion(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const matched = String(value).trim().match(/^v?\s*(\d+)$/i);
    return matched ? Number(matched[1]) : NaN;
  }

  /* 新增作品：同时生成 v1 样稿确认单并绑定 */
  function createWork(state, input) {
    const base = (input.base || "").trim();
    const theme = (input.theme || "").trim();
    const contact = (input.contact || "").trim();
    const line = input.line || "细线";
    if (!base || !theme || !contact || !input.dryDate || !input.delivery) {
      return fail(409, "新增作品缺项：胎体、纹样、联系人、阴干日期与交付日期均为必填");
    }
    const work = {
      id: uid(),
      base: base,
      theme: theme,
      line: line,
      progress: Math.max(0, Math.min(100, Number(input.progress) || 0)),
      dryDate: input.dryDate,
      gold: input.gold || "未处理",
      delivery: input.delivery,
      note: (input.note || "").trim(),
      status: FLOW_STATUSES.indexOf(input.status) >= 0 ? input.status : "贴线中",
      currentConfirmationId: null,
      defects: [],
      logs: [],
      createdAt: now()
    };
    const confirmation = {
      id: uid(),
      workId: work.id,
      version: 1,
      snapshot: { base: base, theme: theme, line: line },
      contact: contact,
      status: "已确认",
      createdAt: now(),
      confirmedAt: now()
    };
    work.currentConfirmationId = confirmation.id;
    pushLog(work, "创建作品，样稿确认单 v1 已确认（联系人：" + contact + "）");
    if (input.initialDefect && String(input.initialDefect).trim()) {
      pushDefect(work, String(input.initialDefect).trim());
      pushLog(work, "缺陷：" + String(input.initialDefect).trim());
    }
    state.works.unshift(work);
    state.confirmations.push(confirmation);
    return succeed({ work: work, confirmation: confirmation });
  }

  /*
   * 登记改样变更单。
   * 返回：
   *   成功新建 { ok:true, reused:false, change }
   *   并发沿用 { ok:true, reused:true,  change } —— 每件仅一份未确认变更
   *   规则冲突 { ok:false, status:409, message }
   */
  function requestChange(state, input) {
    const work = findWork(state, input.workId);
    if (!work) return fail(404, "作品不存在");

    const existing = pendingChangeFor(state, work.id);
    if (existing) return succeed({ reused: true, change: existing });

    const contact = (input.contact || "").trim();
    const reason = (input.reason || "").trim();
    const version = parseVersion(input.version);
    if (!contact || !reason || version === null) {
      return fail(409, "变更登记缺项：联系人、样稿版本和原因均为必填", { code: "MISSING_FIELDS" });
    }

    const current = currentConfirmation(state, work);
    if (!current || current.status !== "已确认") {
      return fail(409, "作品未绑定有效的样稿确认单，无法登记变更", { code: "NO_CONFIRMATION" });
    }
    if (Number.isNaN(version)) {
      return fail(409, "样稿版本格式不正确，应为 v" + current.version, { code: "BAD_VERSION" });
    }
    if (version !== current.version) {
      return fail(409, "样稿版本不一致：当前为 v" + current.version + "，提交为 " + String(input.version).trim() + "，请刷新后重试",
        { code: "VERSION_CONFLICT", currentVersion: current.version });
    }

    const proposed = {
      base: (input.base !== undefined && String(input.base).trim()) ? String(input.base).trim() : current.snapshot.base,
      theme: (input.theme !== undefined && String(input.theme).trim()) ? String(input.theme).trim() : current.snapshot.theme,
      line: SPEC_KEYS.indexOf("line") >= 0 && input.line ? input.line : current.snapshot.line
    };
    const changed = SPEC_KEYS.some(function (k) { return proposed[k] !== current.snapshot[k]; });
    if (!changed) {
      return fail(409, "纹样、胎体、线条均未变化，无需新建变更单", { code: "NO_DIFF" });
    }

    const change = {
      id: uid(),
      workId: work.id,
      contact: contact,
      reason: reason,
      baseVersion: current.version,
      proposed: proposed,
      status: BLOCKED,
      fromStatus: work.status,
      invalidatedConfirmationId: current.id,
      createdAt: now(),
      createdAtText: nowText(),
      resolvedAt: null,
      newConfirmationId: null
    };
    current.status = "已失效";
    current.invalidatedAt = now();
    work.status = BLOCKED;
    pushLog(work, "客户改样，登记变更单（联系人：" + contact + "，依据样稿 v" + current.version +
      "，原因：" + reason + "），旧确认 v" + current.version + " 失效，作品停在待复确认");
    state.changes.push(change);
    return succeed({ reused: false, change: change });
  }

  /* 复确认：按变更单生成新版本确认单，应用新样稿，恢复原工序 */
  function confirmChange(state, changeId) {
    const change = state.changes.find(function (c) { return c.id === changeId; });
    if (!change) return fail(404, "变更单不存在");
    if (change.status !== BLOCKED) {
      return fail(409, "该变更单已处理，不能重复确认", { code: "NOT_PENDING" });
    }
    const work = findWork(state, change.workId);
    if (!work) return fail(404, "作品不存在");

    const old = state.confirmations.find(function (c) { return c.id === change.invalidatedConfirmationId; });
    const nextVersion = (old ? old.version : change.baseVersion) + 1;
    const confirmation = {
      id: uid(),
      workId: work.id,
      version: nextVersion,
      snapshot: { base: change.proposed.base, theme: change.proposed.theme, line: change.proposed.line },
      contact: change.contact,
      status: "已确认",
      createdAt: now(),
      confirmedAt: now()
    };
    work.base = confirmation.snapshot.base;
    work.theme = confirmation.snapshot.theme;
    work.line = confirmation.snapshot.line;
    state.confirmations.push(confirmation);
    work.currentConfirmationId = confirmation.id;

    change.status = "已确认";
    change.resolvedAt = now();
    change.newConfirmationId = confirmation.id;
    work.status = FLOW_STATUSES.indexOf(change.fromStatus) >= 0 ? change.fromStatus : "贴线中";
    pushLog(work, "变更单复确认通过，样稿升级为 v" + nextVersion + "，恢复工序：" + work.status);
    return succeed({ confirmation: confirmation });
  }

  /* 撤回未确认变更：原确认单重新生效，作品回到原工序（变更单本身留档） */
  function withdrawChange(state, changeId) {
    const change = state.changes.find(function (c) { return c.id === changeId; });
    if (!change) return fail(404, "变更单不存在");
    if (change.status !== BLOCKED) {
      return fail(409, "该变更单已处理，不能撤回", { code: "NOT_PENDING" });
    }
    const work = findWork(state, change.workId);
    if (!work) return fail(404, "作品不存在");

    const old = state.confirmations.find(function (c) { return c.id === change.invalidatedConfirmationId; });
    if (old) {
      old.status = "已确认";
      old.reinstatedAt = now();
      work.currentConfirmationId = old.id;
    }
    change.status = "已撤回";
    change.resolvedAt = now();
    work.status = FLOW_STATUSES.indexOf(change.fromStatus) >= 0 ? change.fromStatus : "贴线中";
    pushLog(work, "变更单撤回（联系人：" + change.contact + "），沿用原样稿确认单 v" +
      (old ? old.version : change.baseVersion) + "，恢复工序：" + work.status);
    return succeed({ change: change });
  }

  /* 工序流转：待复确认期间禁止流转；阴干/交付须绑定有效确认单 */
  function changeStatus(state, workId, nextStatus) {
    const work = findWork(state, workId);
    if (!work) return fail(404, "作品不存在");
    if (FLOW_STATUSES.indexOf(nextStatus) < 0) {
      return fail(409, "非法工序状态：" + nextStatus);
    }
    if (work.status === BLOCKED) {
      return fail(409, "作品停在待复确认，须先复确认当前变更单才能继续流转");
    }
    if (GUARDED_STATUSES.indexOf(nextStatus) >= 0) {
      const current = currentConfirmation(state, work);
      if (!current || current.status !== "已确认") {
        return fail(409, "作品未绑定当前有效的样稿确认单，不能继续阴干或交付");
      }
    }
    if (work.status === nextStatus) return succeed({ work: work });

    work.status = nextStatus;
    if (nextStatus === "待阴干") work.dryDate = new Date().toISOString().slice(0, 10);
    if (nextStatus === "上金粉") work.gold = "已上金粉";
    if (nextStatus === "待交付") work.progress = 100;
    pushLog(work, "工序更新为 " + nextStatus);
    return succeed({ work: work });
  }

  /* 缺陷只追加，永不覆盖既有记录 */
  function addDefect(state, workId, text) {
    const work = findWork(state, workId);
    if (!work) return fail(404, "作品不存在");
    const value = (text || "").trim();
    if (!value) return fail(400, "缺陷内容不能为空");
    pushDefect(work, value);
    pushLog(work, "缺陷：" + value);
    return succeed({ defect: work.defects[work.defects.length - 1] });
  }

  /* 履历：确认单 / 变更单 / 缺陷 / 流转 合并为只读时间线 */
  function getHistory(state, workId) {
    const items = [];
    state.confirmations
      .filter(function (c) { return c.workId === workId; })
      .forEach(function (c) {
        items.push({
          kind: "confirmation",
          at: c.confirmedAt || c.createdAt,
          version: c.version,
          status: c.status,
          snapshot: c.snapshot,
          contact: c.contact
        });
      });
    state.changes
      .filter(function (c) { return c.workId === workId; })
      .forEach(function (c) {
        items.push({
          kind: "change",
          at: c.createdAt,
          change: c
        });
      });
    const work = findWork(state, workId);
    if (work) {
      work.defects.forEach(function (d) {
        items.push({ kind: "defect", at: d.at, atText: d.atText, text: d.text });
      });
      work.logs.forEach(function (l) {
        items.push({ kind: "log", at: l.at, atText: l.atText, text: l.text });
      });
    }
    return items.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  }

  window.ZFLRules = {
    STATUSES: STATUSES,
    FLOW_STATUSES: FLOW_STATUSES,
    BLOCKED: BLOCKED,
    GUARDED_STATUSES: GUARDED_STATUSES,
    SPEC_KEYS: SPEC_KEYS,
    uid: uid,
    parseVersion: parseVersion,
    currentConfirmation: currentConfirmation,
    pendingChangeFor: pendingChangeFor,
    createWork: createWork,
    requestChange: requestChange,
    confirmChange: confirmChange,
    withdrawChange: withdrawChange,
    changeStatus: changeStatus,
    addDefect: addDefect,
    getHistory: getHistory
  };
})();
