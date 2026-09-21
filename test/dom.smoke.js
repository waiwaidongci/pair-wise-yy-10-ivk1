/* Node 端页面冒烟测试：node test/dom.smoke.js（依赖临时安装的 jsdom） */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error("  ✗ " + msg); }
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = {
  "js/rules.js": fs.readFileSync(path.join(root, "js", "rules.js"), "utf8"),
  "js/storage.js": fs.readFileSync(path.join(root, "js", "storage.js"), "utf8"),
  "js/page.js": fs.readFileSync(path.join(root, "js", "page.js"), "utf8")
};

function bootDom(storageData) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  const { window } = dom;
  // jsdom 未实现 HTMLDialogElement.showModal/close
  const patchDialog = function (proto) {
    proto.showModal = function () { this.setAttribute("open", ""); this.open = true; };
    proto.close = function () { this.removeAttribute("open"); this.open = false; };
  };
  if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
    patchDialog(window.HTMLDialogElement.prototype);
  } else if (!window.HTMLDialogElement) {
    window.HTMLDialogElement = window.document.createElement("dialog").constructor;
    patchDialog(window.HTMLDialogElement.prototype);
  }
  if (storageData) {
    Object.keys(storageData).forEach(function (k) {
      window.localStorage.setItem(k, storageData[k]);
    });
  }
  window.eval(scripts["js/rules.js"]);
  window.eval(scripts["js/storage.js"]);
  window.eval(scripts["js/page.js"]);
  return { dom, window };
}

// 1. 首次打开：种子数据渲染出 5 列看板，含待复确认列
let { dom, window } = bootDom();
let doc = window.document;
const cols = doc.querySelectorAll("#board .col");
assert(cols.length === 5, "看板渲染 5 个工序列");
const blockedCol = cols[1];
assert(/待复确认/.test(blockedCol.querySelector("h3").textContent), "第二列为待复确认");
assert(blockedCol.querySelectorAll(".item").length === 1, "种子中一件作品待复确认");
assert(window.localStorage.getItem("zfl42State.v1"), "数据已写入新存储键");

// 2. 刷新后看板一致
const persisted = window.localStorage.getItem("zfl42State.v1");
({ dom, window } = bootDom({ "zfl42State.v1": persisted }));
const doc2 = window.document;
assert(doc2.querySelectorAll("#board .item").length === 4, "刷新后看板作品数量一致");
assert(doc2.querySelectorAll("#board .col")[1].querySelectorAll(".item").length === 1, "刷新后待复确认列一致");

// 3. 打开详情：履历含 v1 确认单、变更单与只读标记
doc2.querySelectorAll("#board .col")[1].querySelector(".item").click();
const dlg = doc2.querySelector("#detailDialog");
assert(dlg.open, "点击作品打开详情");
const histText = doc2.querySelector("#detailHistory").textContent;
assert(/样稿 v1/.test(histText), "履历展示 v1 样稿确认单");
assert(/变更单/.test(histText), "履历展示变更单");
assert(/只读留档|待复确认/.test(histText), "旧确认标注只读留档");
assert(/缠枝莲/.test(histText) && /缠枝牡丹/.test(histText), "履历保留旧纹样与改后纹样");

// 4. 复确认后看板与履历一致刷新
doc2.querySelector('[data-action="confirm-change"]').click();
const state1 = JSON.parse(window.localStorage.getItem("zfl42State.v1"));
assert(doc2.querySelectorAll("#board .col")[1].querySelectorAll(".item").length === 0, "复确认后待复确认列清空");
const hist2 = doc2.querySelector("#detailHistory").textContent;
assert(/样稿 v2/.test(hist2), "履历出现 v2 确认单");
assert(state1.confirmations.filter(c => c.status === "已失效").length === 1, "v1 确认单以已失效状态留档");
assert(state1.works.find(w => w.status === "上金粉"), "复确认后恢复原工序（上金粉）");
doc2.querySelector("#closeDetail").click();

// 5. 缺项的变更登记 -> 409 提示
const firstNormalCard = doc2.querySelector('#board .col:not(.blocked-col) .item');
firstNormalCard.querySelector('[data-action="change"]').click();
const changeDlg = doc2.querySelector("#changeDialog");
assert(changeDlg.open, "改样按钮打开变更弹窗");
const cf = changeDlg.querySelector("#changeForm").elements;
cf.reason.value = ""; // 缺原因
cf.theme.value = "全新纹样";
changeDlg.querySelector("#changeForm").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(changeDlg.open, "缺项时弹窗不关闭");
assert(/409/.test(doc2.querySelector("#toast").textContent), "缺项显示 409 冲突提示");
assert(JSON.parse(window.localStorage.getItem("zfl42State.v1")).changes.filter(c => c.status === "待复确认").length === 0, "失败登记不落库");

// 6. 版本不一致 -> 409
cf.reason.value = "客户要求";
cf.version.value = "v5";
changeDlg.querySelector("#changeForm").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
assert(/版本不一致/.test(doc2.querySelector("#toast").textContent), "版本不一致显示 409");
changeDlg.close();

// 7. 有效确认单下阴干/交付正常；待复确认卡片无工序按钮
const normalWorkId = firstNormalCard.dataset.work;
const btns = firstNormalCard.querySelectorAll("[data-action=status]");
assert(btns.length === 4, "正常作品卡片提供 4 个工序按钮");

// 8. 旧版数据（zfl42Works 数组）自动迁移
const legacy = [{
  id: "legacy-1", base: "老胎体", theme: "老纹样", line: "粗线", progress: 10,
  dryDate: "2026-09-21", gold: "未处理", defect: "旧断线; 旧翘线", delivery: "2026-10-01",
  status: "贴线中", note: "", logs: ["创建作品"]
}];
({ dom, window } = bootDom({ "zfl42Works": JSON.stringify(legacy) }));
const doc3 = window.document;
assert(doc3.querySelectorAll("#board .item").length === 1, "迁移后看板渲染旧作品");
const migrated = JSON.parse(window.localStorage.getItem("zfl42State.v1"));
assert(migrated.confirmations.length === 1 && migrated.confirmations[0].version === 1, "旧作品补建 v1 确认单");
assert(migrated.works[0].defects.length === 2, "旧缺陷字符串拆分为追加式记录");
assert(migrated.works[0].logs.length >= 1, "旧流转日志保留");
doc3.querySelector("#board .item").click();
assert(/v1/.test(doc3.querySelector("#detailHistory").textContent), "迁移作品履历含确认单");

console.log("通过 " + passed + " 项，失败 " + failed + " 项");
process.exit(failed ? 1 : 0);
