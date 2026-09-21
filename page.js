/*
 * page.js —— 页面层：DOM 渲染与交互。
 * 本文件不实现任何业务判定，创建、改样、复确认、流转、缺陷全部调用 WorkshopRules；
 * 每次操作后落盘 WorkshopStorage，刷新后看板与履历一致。
 */
(function (global) {
  "use strict";

  var R = global.WorkshopRules;
  var Store = global.WorkshopStorage;

  var BOARD_COLUMNS = R.STATUSES.concat(R.HOLD_STATUS);

  var works = Store.load();
  var activeId = null;

  var $ = function (selector) { return document.querySelector(selector); };

  var form = $("#workForm");
  var board = $("#board");
  var statusFilter = $("#statusFilter");
  var themeFilter = $("#themeFilter");
  var sortMode = $("#sortMode");
  var detailDialog = $("#detailDialog");
  var changeDialog = $("#changeDialog");
  var changeForm = $("#changeForm");
  var changeError = $("#changeError");
  var defectInput = $("#defectInput");
  var toastBox = $("#toast");

  form.dryDate.value = R.today();
  form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  statusFilter.innerHTML =
    '<option value="">全部状态</option>' +
    R.ALL_STATUSES.map(function (s) { return "<option>" + s + "</option>"; }).join("");

  /* ---------- 通用 ---------- */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function persist() {
    Store.persist(works);
  }

  function findWork(id) {
    return works.find(function (w) { return w.id === id; }) || null;
  }

  function toast(message, ok) {
    var el = document.createElement("div");
    el.className = "toast " + (ok ? "ok" : "err");
    el.textContent = message;
    toastBox.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function notify(result, successText) {
    if (!result || result.ok === false) {
      toast((result && result.status ? result.status + " " : "") + (result ? result.message : "操作失败"), false);
      return false;
    }
    toast(successText, true);
    return true;
  }

  function filteredWorks() {
    var keyword = themeFilter.value.trim();
    return works
      .filter(function (w) { return !statusFilter.value || w.status === statusFilter.value; })
      .filter(function (w) { return !keyword || w.theme.indexOf(keyword) !== -1; })
      .sort(function (a, b) {
        return String(a[sortMode.value] || "").localeCompare(String(b[sortMode.value] || ""));
      });
  }

  /* ---------- 详情对话框 ---------- */

  function currentSpecText(w) {
    return "当前样稿 v" + w.sampleVersion + "：" + w.theme + " · " + w.base + " · " + w.line;
  }

  function renderHistory(w) {
    var entries = w.history.map(function (entry) {
      var isChange = entry.kind === "改样";
      var isPending = isChange && entry.status === "待复确认";
      var isReadonly = !isPending;
      var badge;
      if (isPending) {
        badge = '<span class="badge pending">待复确认</span>';
      } else if (w.confirmation && w.confirmation.id === entry.id && entry.version === w.sampleVersion) {
        badge = '<span class="badge current">当前确认单</span>';
      } else {
        badge = '<span class="badge invalid">已失效 · 只读留档</span>';
      }
      var spec;
      if (isChange) {
        spec =
          "由 v" + entry.fromVersion + " 升至 v" + entry.version + "<br>" +
          esc(R.specDiff(entry.from, entry.to));
      } else {
        spec = "v" + entry.version + "：" + esc(entry.spec.theme) + " · " + esc(entry.spec.base) + " · " + esc(entry.spec.line);
      }
      return '<div class="history-entry' + (isReadonly ? " readonly" : "") + '">' +
        "<h4>" + esc(entry.kind) + " · v" + entry.version + badge + "</h4>" +
        spec +
        "<div class='meta'>联系人：" + esc(entry.contact) +
        " · 原因：" + esc(entry.reason) +
        " · 登记：" + esc(entry.createdAt) +
        (entry.confirmedAt ? " · 确认：" + esc(entry.confirmedAt) : "") +
        "</div></div>";
    }).join("");

    return "<h3 style='margin:6px 0 8px;font-size:14px;'>样稿确认履历（旧版本只读，不可覆盖）</h3>" +
      '<div class="history">' + entries + "</div>";
  }

  function showDetail(id) {
    var w = findWork(id);
    if (!w) return;
    activeId = id;

    var pending = R.pendingChange(w);
    $("#detailTitle").textContent = w.theme + " · " + w.base;
    $("#detailContent").innerHTML =
      (pending
        ? '<div class="box pending">变更单 v' + pending.version + " 待复确认，作品停在「" + R.HOLD_STATUS +
          "」<br><span class='meta'>将改为：" + esc(pending.to.theme) + " · " + esc(pending.to.base) + " · " + esc(pending.to.line) +
          " · 联系人：" + esc(pending.contact) + " · 原因：" + esc(pending.reason) + "</span></div>"
        : '<div class="box">' + currentSpecText(w) +
          '<span class="badge current">已绑定当前确认单</span></div>') +
      '<div class="box" style="margin-top:8px;">' +
      "胎体材质：" + esc(w.base) + "<br>线条粗细：" + esc(w.line) + "<br>贴线进度：" + w.progress + "%<br>" +
      "阴干日期：" + esc(w.dryDate) + "<br>金粉状态：" + esc(w.gold) +
      "<br>缺陷记录：" + (w.defects.length ? esc(w.defects.map(function (d) { return d.text; }).join("；")) : "无") +
      "<br>交付日期：" + esc(w.delivery) + "<br>当前状态：" + esc(w.status) +
      "<br>备注：" + esc(w.note || "无") +
      "<br><br>流转记录（只追加）：<br>" +
      w.logs.map(function (log) { return "· " + esc(log); }).join("<br>") +
      "</div>";
    $("#detailHistory").innerHTML = renderHistory(w);

    $("#confirmChange").hidden = !pending;
    $("#openChange").hidden = !!pending;
    defectInput.value = "";
    if (!detailDialog.open) detailDialog.showModal();
  }

  /* ---------- 改样对话框 ---------- */

  function openChangeDialog() {
    var w = findWork(activeId);
    if (!w) return;
    var pending = R.pendingChange(w);
    if (pending) {
      toast("409 已有待复确认变更单（v" + pending.version + "），重复请求沿用首次登记", false);
      return;
    }
    $("#changeCurrent").innerHTML =
      currentSpecText(w) +
      '<br><span class="meta">请按当前版本登记；版本不一致或缺项将返回 409。变更单新建后旧确认失效，作品停在「' +
      R.HOLD_STATUS + "」。</span>";
    changeForm.contact.value = "";
    changeForm.version.value = "v" + w.sampleVersion;
    changeForm.reason.value = "";
    changeForm.theme.value = w.theme;
    changeForm.base.value = w.base;
    changeForm.line.value = w.line;
    changeError.hidden = true;
    detailDialog.close();
    changeDialog.showModal();
  }

  function submitChange(event) {
    event.preventDefault();
    var w = findWork(activeId);
    if (!w) return;
    var data = Object.fromEntries(new FormData(changeForm).entries());
    var result = R.requestChange(w, data);
    if (result.ok === false) {
      changeError.textContent = result.status + " " + result.message;
      changeError.hidden = false;
      toast(result.status + " " + result.message, false);
      return;
    }
    persist();
    changeError.hidden = true;
    changeDialog.close();
    toast(
      result.reused
        ? "沿用首次变更单（v" + result.change.version + "，待复确认）"
        : "变更单 v" + result.change.version + " 已登记，旧确认失效，作品停在「待复确认」",
      true
    );
    renderAll();
    showDetail(w.id);
  }

  function doConfirmChange() {
    var w = findWork(activeId);
    if (!w) return;
    var result = R.confirmChange(w);
    if (notify(result, "样稿 v" + w.sampleVersion + " 复确认通过并绑定，作品恢复「" + w.status + "」")) {
      persist();
      renderAll();
      showDetail(w.id);
    }
  }

  /* ---------- 看板 ---------- */

  function makeButton(text, className, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = className || "";
    btn.textContent = text;
    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  function cardMeta(w) {
    var pending = R.pendingChange(w);
    if (pending) {
      return (
        "<span class='tag'>变更单 v" + pending.version + " 待复确认</span><br>" +
        "将改为：" + esc(pending.to.theme) + " · " + esc(pending.to.base) + " · " + esc(pending.to.line) + "<br>" +
        "挂起前工序：" + esc(w.statusBeforeHold || "贴线中") + " · 联系人：" + esc(pending.contact) + "<br>" +
        "缺陷：" + (w.defects.length ? esc(w.defects.map(function (d) { return d.text; }).join("；")) : "无")
      );
    }
    return (
      esc(w.base) + " · " + esc(w.line) + "<br>" +
      "进度 " + w.progress + "% · 阴干 " + esc(w.dryDate) + "<br>" +
      "金粉：" + esc(w.gold) + " · 交付：" + esc(w.delivery) + "<br>" +
      (w.defects.length ? "缺陷：" + esc(w.defects.map(function (d) { return d.text; }).join("；")) : "缺陷：无")
    );
  }

  function renderCard(w) {
    var pending = R.pendingChange(w);
    var item = document.createElement("article");
    item.className = "item" + (pending ? " hold" : w.defects.length ? " overdue" : "");

    var title = document.createElement("div");
    title.innerHTML = "<b>" + esc(w.theme) + "</b> <span class='meta'>v" + w.sampleVersion + "</span>";
    item.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = cardMeta(w);
    item.appendChild(meta);

    var actions = document.createElement("div");
    actions.className = "actions";

    if (pending) {
      actions.appendChild(makeButton("复确认", "danger", function () {
        var result = R.confirmChange(w);
        if (notify(result, "复确认通过，作品恢复「" + w.status + "」")) {
          persist();
          renderAll();
          showDetail(w.id);
        }
      }));
    } else {
      R.STATUSES.forEach(function (s) {
        actions.appendChild(makeButton(s, s === w.status ? "secondary" : "", function () {
          var result = R.transition(w, s);
          if (notify(result, "已流转：" + s)) {
            persist();
            renderAll();
          }
        }));
      });
    }
    actions.appendChild(makeButton("改样", "violet", function () {
      activeId = w.id;
      openChangeDialog();
    }));
    actions.appendChild(makeButton("记缺陷", "warn", function () {
      var text = prompt("输入断线/翘线位置");
      var result = R.addDefect(w, text || "");
      if (notify(result, "缺陷已追加记录")) {
        persist();
        renderAll();
      }
    }));
    item.appendChild(actions);
    item.addEventListener("click", function () { showDetail(w.id); });
    return item;
  }

  function renderBoard() {
    var list = filteredWorks();
    board.innerHTML = "";
    BOARD_COLUMNS.forEach(function (status) {
      var col = document.createElement("section");
      col.className = "col" + (status === R.HOLD_STATUS ? " hold-col" : "");

      var h3 = document.createElement("h3");
      var label = document.createElement("span");
      label.textContent = status;
      var count = document.createElement("span");
      var cards = list.filter(function (w) { return w.status === status; });
      count.textContent = cards.length;
      h3.appendChild(label);
      h3.appendChild(count);
      col.appendChild(h3);

      if (cards.length) {
        cards.forEach(function (w) { col.appendChild(renderCard(w)); });
      } else {
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "暂无作品";
        col.appendChild(empty);
      }
      board.appendChild(col);
    });
  }

  /* ---------- 顶部小列表 ---------- */

  function clickableItem(w, html, extraClass) {
    var div = document.createElement("div");
    div.className = "item" + (extraClass || "");
    div.innerHTML = html;
    div.addEventListener("click", function () { showDetail(w.id); });
    return div;
  }

  function renderSummaries() {
    var mount = function (id, nodes) {
      var box = $(id);
      box.innerHTML = "";
      if (!nodes.length) {
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "暂无";
        box.appendChild(empty);
      } else {
        nodes.forEach(function (node) { box.appendChild(node); });
      }
    };

    var todayDry = works.filter(function (w) {
      return w.dryDate <= R.today() && w.status === "待阴干";
    });
    mount("#todayDry", todayDry.map(function (w) {
      return clickableItem(w, "<b>" + esc(w.theme) + "</b><div class='meta'>" + esc(w.base) + " · " + esc(w.dryDate) + "</div>");
    }));

    var pending = works.filter(function (w) { return R.pendingChange(w); });
    mount("#pendingConfirm", pending.map(function (w) {
      var change = R.pendingChange(w);
      return clickableItem(
        w,
        "<b>" + esc(w.theme) + "</b><div class='meta'>变更单 v" + change.version +
          " · " + esc(change.contact) + "</div>",
        "hold"
      );
    }));

    var delivery = works.slice().sort(function (a, b) {
      return String(a.delivery).localeCompare(String(b.delivery));
    }).slice(0, 4);
    mount("#deliveryList", delivery.map(function (w) {
      return clickableItem(w, "<b>" + esc(w.theme) + "</b><div class='meta'>" + esc(w.delivery) + " · " + esc(w.status) + "</div>");
    }));
  }

  function renderAll() {
    renderSummaries();
    renderBoard();
  }

  /* ---------- 事件绑定 ---------- */

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    var result = R.createWork(data);
    if (result.ok === false) {
      toast(result.status + " " + result.message, false);
      return;
    }
    works.unshift(result.work);
    // 新增即绑定 v1 确认单，表单所选工序（含阴干/交付）天然满足门控
    persist();
    form.reset();
    form.dryDate.value = R.today();
    form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    renderAll();
    toast("作品已加入，样稿 v1 确认单已绑定", true);
  });

  $("#saveDefect").addEventListener("click", function () {
    var w = findWork(activeId);
    if (!w) return;
    var result = R.addDefect(w, defectInput.value);
    if (notify(result, "缺陷已追加，既有记录保持不变")) {
      defectInput.value = "";
      persist();
      renderAll();
      showDetail(w.id);
    }
  });

  $("#openChange").addEventListener("click", openChangeDialog);
  $("#confirmChange").addEventListener("click", doConfirmChange);
  changeForm.addEventListener("submit", submitChange);
  $("#cancelChange").addEventListener("click", function () {
    changeDialog.close();
    if (findWork(activeId)) detailDialog.showModal();
  });
  $("#closeDialog").addEventListener("click", function () { detailDialog.close(); });

  $("#clearFilters").addEventListener("click", function () {
    themeFilter.value = "";
    statusFilter.value = "";
    renderAll();
  });
  [statusFilter, themeFilter, sortMode].forEach(function (el) {
    el.addEventListener("input", renderAll);
  });

  $("#exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(works, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-workshop.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  renderAll();
})(window);
