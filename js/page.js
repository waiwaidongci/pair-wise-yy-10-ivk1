/*
 * page.js —— 页面层：DOM 渲染、表单与事件；调用规则层，经存储层持久化。
 * 页面不直接改写业务数据，所有变更走 ZFLRules，保证看板与履历一致。
 */
(function () {
  "use strict";

  const R = window.ZFLRules;
  const Store = window.ZFLStorage;
  let state = Store.load();
  let activeId = null;

  const $ = function (sel) { return document.querySelector(sel); };
  const today = new Date().toISOString().slice(0, 10);

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("zh-CN", { hour12: false });
  }
  function persist() { Store.save(state); }

  /* ---------- 提示（409 等业务冲突在此展示） ---------- */
  let toastTimer = null;
  function toast(message, kind) {
    const box = $("#toast");
    box.textContent = (kind === "error" ? "409 冲突：" : "") + message;
    box.className = "toast show " + (kind || "ok");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = "toast"; }, 3200);
  }
  function report(result, okText) {
    if (!result.ok) {
      toast(result.message, "error");
      return false;
    }
    if (okText) toast((result.reused ? "已有未确认变更，沿用首次登记：" : "") + okText, result.reused ? "info" : "ok");
    return true;
  }

  /* ---------- 查询 / 派生 ---------- */
  function workById(id) { return state.works.find(function (w) { return w.id === id; }); }

  function filteredWorks() {
    const theme = $("#themeFilter").value.trim();
    const status = $("#statusFilter").value;
    return state.works
      .filter(function (w) { return !status || w.status === status; })
      .filter(function (w) { return !theme || w.theme.includes(theme); })
      .sort(function (a, b) {
        const key = $("#sortMode").value;
        return String(a[key] || "").localeCompare(String(b[key] || ""));
      });
  }

  function diffLines(snapshot, proposed) {
    const labels = { base: "胎体", theme: "纹样", line: "线条" };
    return R.SPEC_KEYS
      .filter(function (k) { return snapshot[k] !== proposed[k]; })
      .map(function (k) { return { key: k, label: labels[k], from: snapshot[k], to: proposed[k] }; });
  }

  /* ---------- 渲染：看板 ---------- */
  function cardHtml(w) {
    const current = R.currentConfirmation(state, w);
    const pending = R.pendingChangeFor(state, w);
    const version = current ? "v" + current.version : "无样稿";
    const lastDefect = w.defects.length ? w.defects[w.defects.length - 1].text : "";

    let actions;
    if (w.status === R.BLOCKED && pending) {
      actions = `
        <button data-action="confirm-change" data-change="${pending.id}" class="violet">复确认</button>
        <button data-action="withdraw-change" data-change="${pending.id}" class="secondary">撤回变更</button>
        <button data-action="defect" data-work="${w.id}" class="warn">记缺陷</button>`;
    } else {
      actions = R.FLOW_STATUSES.map(function (s) {
        return `<button data-action="status" data-work="${w.id}" data-status="${s}" class="${s === w.status ? "secondary" : ""}">${s}</button>`;
      }).join("") + `
        <button data-action="change" data-work="${w.id}" class="violet">改样</button>
        <button data-action="defect" data-work="${w.id}" class="warn">记缺陷</button>`;
    }

    const pendingBanner = pending
      ? `<div class="pending-banner">待复确认 · ${esc(pending.contact)}<br>${esc(pending.reason)}</div>`
      : "";

    return `<article class="item ${w.defects.length ? "overdue" : ""}" data-work="${w.id}">
      <b>${esc(w.theme)}</b>
      <div class="meta">${esc(w.base)} · ${esc(w.line)} · <span class="ver">样稿 ${esc(version)}</span><br>
        进度 ${w.progress}% · 阴干 ${esc(w.dryDate)}<br>
        金粉：${esc(w.gold)} · 交付：${esc(w.delivery)}<br>
        缺陷：${lastDefect ? esc(lastDefect) : "无"}${w.defects.length > 1 ? "（共 " + w.defects.length + " 条）" : ""}
      </div>
      ${pendingBanner}
      <div class="actions">${actions}</div>
    </article>`;
  }

  function renderBoard() {
    const list = filteredWorks();
    $("#board").innerHTML = R.STATUSES.map(function (status) {
      const cards = list.filter(function (w) { return w.status === status; });
      const isBlockedCol = status === R.BLOCKED;
      return `<section class="col ${isBlockedCol ? "blocked-col" : ""}">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(cardHtml).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function renderSummaries() {
    const todayDry = state.works.filter(function (w) {
      return w.dryDate <= today && w.status === "待阴干";
    });
    const defects = state.works.filter(function (w) { return w.defects.length; });
    const delivery = state.works.slice().sort(function (a, b) {
      return String(a.delivery).localeCompare(String(b.delivery));
    }).slice(0, 4);

    $("#todayDry").innerHTML = todayDry.length
      ? todayDry.map(function (w) {
        return `<div class="item" data-work="${w.id}"><b>${esc(w.theme)}</b><div class="meta">${esc(w.base)} · ${esc(w.dryDate)}</div></div>`;
      }).join("")
      : `<div class="empty">暂无</div>`;
    $("#defectList").innerHTML = defects.length
      ? defects.map(function (w) {
        return `<div class="item overdue" data-work="${w.id}"><b>${esc(w.theme)}</b><div class="meta">${esc(w.defects[w.defects.length - 1].text)}</div></div>`;
      }).join("")
      : `<div class="empty">暂无</div>`;
    $("#deliveryList").innerHTML = delivery.map(function (w) {
      return `<div class="item" data-work="${w.id}"><b>${esc(w.theme)}</b><div class="meta">${esc(w.delivery)} · ${esc(w.status)}</div></div>`;
    }).join("");
  }

  function render() {
    renderSummaries();
    renderBoard();
  }

  /* ---------- 详情与履历 ---------- */
  function historyRow(item) {
    if (item.kind === "confirmation") {
      const c = item;
      const badge = c.status === "已确认" ? `<span class="tag ok">已确认</span>` : `<span class="tag archived">${esc(c.status)} · 只读留档</span>`;
      return `<div class="tl-row">
        <div class="tl-time">${fmt(item.at)}</div>
        <div><span class="tag ver">样稿 v${c.version}</span> ${badge}
          <div class="meta">胎体：${esc(c.snapshot.base)} · 纹样：${esc(c.snapshot.theme)} · 线条：${esc(c.snapshot.line)}</div>
          <div class="meta">确认联系人：${esc(c.contact)}</div>
        </div>
      </div>`;
    }
    if (item.kind === "change") {
      const c = item.change;
      const statusBadge = {
        "待复确认": `<span class="tag warn">待复确认</span>`,
        "已确认": `<span class="tag ok">已复确认 → v${c.baseVersion + 1}</span>`,
        "已撤回": `<span class="tag archived">已撤回 · 留档</span>`
      }[c.status] || "";
      const current = state.confirmations.find(function (x) { return x.id === c.invalidatedConfirmationId; });
      const diffs = current ? diffLines(current.snapshot, c.proposed) : [];
      return `<div class="tl-row">
        <div class="tl-time">${fmt(item.at)}</div>
        <div><span class="tag change">变更单</span> ${statusBadge}
          <div class="meta">联系人：${esc(c.contact)} · 依据样稿 v${c.baseVersion}</div>
          <div class="meta">原因：${esc(c.reason)}</div>
          <div class="meta">${diffs.map(function (d) {
        return esc(d.label) + "：" + esc(d.from) + " → " + esc(d.to);
      }).join("；")}</div>
        </div>
      </div>`;
    }
    if (item.kind === "defect") {
      return `<div class="tl-row">
        <div class="tl-time">${esc(item.atText) || fmt(item.at)}</div>
        <div><span class="tag warn">缺陷</span> ${esc(item.text)}</div>
      </div>`;
    }
    return `<div class="tl-row">
      <div class="tl-time">${esc(item.atText) || fmt(item.at)}</div>
      <div><span class="tag log">流转</span> ${esc(item.text)}</div>
    </div>`;
  }

  function showDetail(id) {
    activeId = id;
    const w = workById(id);
    if (!w) return;
    const current = R.currentConfirmation(state, w);
    const pending = R.pendingChangeFor(state, id);

    $("#detailTitle").textContent = w.theme + " · " + w.base;
    $("#detailContent").innerHTML = `
      胎体材质：${esc(w.base)}<br>线条粗细：${esc(w.line)}<br>贴线进度：${w.progress}%<br>
      阴干日期：${esc(w.dryDate)}<br>金粉状态：${esc(w.gold)}<br>交付日期：${esc(w.delivery)}<br>
      当前状态：<b>${esc(w.status)}</b><br>备注：${esc(w.note || "无")}
      <div class="confirm-box">
        当前样稿确认单：${current
        ? `<span class="tag ver">v${current.version}</span> <span class="tag ${current.status === "已确认" ? "ok" : "archived"}">${esc(current.status)}</span> 联系人：${esc(current.contact)}`
        : `<span class="tag warn">无绑定确认单</span>`}
      </div>`;

    $("#detailPending").innerHTML = pending
      ? `<div class="pending-box">
          <b>待复确认变更单</b>
          <div class="meta">联系人：${esc(pending.contact)} · 登记于 ${fmt(pending.createdAt)}</div>
          <div class="meta">原因：${esc(pending.reason)}</div>
          <div class="meta">${(function () {
            const old = state.confirmations.find(function (c) { return c.id === pending.invalidatedConfirmationId; });
            return old
              ? diffLines(old.snapshot, pending.proposed)
                  .map(function (d) { return esc(d.label) + "：" + esc(d.from) + " → " + esc(d.to); }).join("；")
              : "原确认单已留档";
          }())}</div>
          <div class="actions">
            <button data-action="confirm-change" data-change="${pending.id}" class="violet">复确认通过</button>
            <button data-action="withdraw-change" data-change="${pending.id}" class="secondary">撤回变更</button>
          </div>
        </div>`
      : "";

    const history = R.getHistory(state, id);
    $("#detailHistory").innerHTML = history.length
      ? history.map(historyRow).join("")
      : `<div class="empty">暂无履历</div>`;
    $("#defectInput").value = "";
    $("#detailDialog").showModal();
  }

  /* ---------- 改样变更弹窗 ---------- */
  function openChange(workId) {
    const w = workById(workId);
    if (!w) return;
    const pending = R.pendingChangeFor(state, workId);
    if (pending) {
      toast("该作品已有未确认变更，沿用首次登记；请先复确认或撤回", "info");
      showDetail(workId);
      return;
    }
    const current = R.currentConfirmation(state, w);
    if (!current || current.status !== "已确认") {
      toast("作品未绑定有效的样稿确认单，无法改样", "error");
      return;
    }
    const form = $("#changeForm");
    form.elements.workId.value = workId;
    form.elements.version.value = "v" + current.version;
    form.elements.base.value = current.snapshot.base;
    form.elements.theme.value = current.snapshot.theme;
    form.elements.line.value = current.snapshot.line;
    form.elements.contact.value = current.contact;
    form.elements.reason.value = "";
    $("#versionHint").textContent = "当前样稿版本 v" + current.version + "，版本不一致将返回 409";
    $("#changeDialog").showModal();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-action]");
    if (btn) {
      const action = btn.dataset.action;
      if (action === "status") {
        const result = R.changeStatus(state, btn.dataset.work, btn.dataset.status);
        if (report(result, "工序已更新为 " + btn.dataset.status)) { persist(); render(); }
      } else if (action === "change") {
        openChange(btn.dataset.work);
      } else if (action === "defect") {
        showDetail(btn.dataset.work);
        $("#defectInput").focus();
      } else if (action === "confirm-change") {
        const result = R.confirmChange(state, btn.dataset.change);
        if (report(result, "复确认通过，新版样稿确认单已生效")) {
          persist(); render();
          if ($("#detailDialog").open) showDetail(activeId);
        }
      } else if (action === "withdraw-change") {
        const result = R.withdrawChange(state, btn.dataset.change);
        if (report(result, "变更单已撤回，原确认单重新生效")) {
          persist(); render();
          if ($("#detailDialog").open) showDetail(activeId);
        }
      }
      return;
    }
    const card = event.target.closest("[data-work]");
    if (card && !event.target.closest(".actions")) {
      showDetail(card.dataset.work);
    }
  });

  $("#workForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const f = event.target.elements;
    const result = R.createWork(state, {
      base: f.base.value, theme: f.theme.value, line: f.line.value,
      progress: f.progress.value, dryDate: f.dryDate.value, gold: f.gold.value,
      delivery: f.delivery.value, status: f.status.value, contact: f.contact.value,
      note: f.note.value, initialDefect: f.initialDefect.value
    });
    if (!report(result, "作品已加入，样稿确认单 v1 已绑定")) return;
    persist();
    event.target.reset();
    f.dryDate.value = today;
    f.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    f.progress.value = 25;
    render();
  });

  $("#changeForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const f = event.target.elements;
    const result = R.requestChange(state, {
      workId: f.workId.value, contact: f.contact.value, reason: f.reason.value,
      version: f.version.value, base: f.base.value, theme: f.theme.value, line: f.line.value
    });
    if (!result.ok) { toast(result.message, "error"); return; }
    persist();
    $("#changeDialog").close();
    render();
    toast(result.reused
      ? "已有未确认变更，沿用首次登记，未重复建单"
      : "变更单已登记：旧确认失效，作品停在待复确认", result.reused ? "info" : "ok");
  });

  $("#saveDefect").addEventListener("click", function () {
    const result = R.addDefect(state, activeId, $("#defectInput").value);
    if (report(result, "缺陷已追加，历史记录保留")) {
      persist();
      render();
      showDetail(activeId);
    }
  });
  $("#closeDetail").addEventListener("click", function () { $("#detailDialog").close(); });
  $("#cancelChange").addEventListener("click", function () { $("#changeDialog").close(); });
  $("#clearFilters").addEventListener("click", function () {
    $("#themeFilter").value = "";
    $("#statusFilter").value = "";
    render();
  });
  ["#statusFilter", "#themeFilter", "#sortMode"].forEach(function (sel) {
    $(sel).addEventListener("input", render);
  });
  $("#exportBtn").addEventListener("click", function () {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-state.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  /* ---------- 初始化 ---------- */
  $("#newDryDate").value = today;
  $("#newDelivery").value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  $("#statusFilter").innerHTML =
    `<option value="">全部状态</option>` + R.STATUSES.map(function (s) { return `<option>${s}</option>`; }).join("");
  persist();
  render();
})();
