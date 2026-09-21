/* Node 端规则层测试：node test/rules.test.js */
const fs = require("fs");
const path = require("path");

global.window = {};
global.crypto = undefined; // 验证 uid 兜底分支
eval(fs.readFileSync(path.join(__dirname, "..", "js", "rules.js"), "utf8"));
const R = global.window.ZFLRules;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ " + msg); }
}
function newState() { return { version: 1, works: [], confirmations: [], changes: [] }; }

// 1. 新增作品自动绑定 v1 确认单
let s = newState();
let r = R.createWork(s, { base: "木胎", theme: "缠枝莲", line: "细线", dryDate: "2026-09-21", delivery: "2026-09-30", contact: "张三" });
assert(r.ok === true, "createWork 成功");
const w = r.work;
const conf = R.currentConfirmation(s, w);
assert(conf.version === 1 && conf.status === "已确认", "v1 确认单已绑定");

// 2. 缺项 -> 409
assert(R.createWork(s, { base: "", theme: "x", contact: "a", dryDate: "d", delivery: "e" }).status === 409, "新增缺项返回 409");

// 3. 绑定确认单时可以进入阴干/交付
assert(R.changeStatus(s, w.id, "待阴干").ok, "有效确认单下可转待阴干");

// 4. 改样：缺字段 -> 409
assert(R.requestChange(s, { workId: w.id, contact: "", reason: "r", version: "v1" }).status === 409, "变更缺联系人 409");
assert(R.requestChange(s, { workId: w.id, contact: "李四", reason: "", version: "v1" }).status === 409, "变更缺原因 409");
assert(R.requestChange(s, { workId: w.id, contact: "李四", reason: "r" }).status === 409, "变更缺版本 409");

// 5. 版本不一致 -> 409
assert(R.requestChange(s, { workId: w.id, contact: "李四", reason: "r", version: "v9", theme: "缠枝牡丹" }).status === 409, "版本不一致 409");

// 6. 无差异 -> 409
assert(R.requestChange(s, { workId: w.id, contact: "李四", reason: "r", version: "v1", base: "木胎", theme: "缠枝莲", line: "细线" }).status === 409, "三样无变化 409");
assert(R.requestChange(s, { workId: w.id, contact: "李四", reason: "r", version: "1" }).status === 409, "未提供新值 409");

// 7. 正常改样：旧确认失效，作品停在待复确认
r = R.requestChange(s, { workId: w.id, contact: "李四", reason: "客户想换牡丹", version: "v1", theme: "缠枝牡丹" });
assert(r.ok && r.reused === false, "首次变更登记成功");
const ch = r.change;
assert(w.status === "待复确认", "作品停在待复确认");
assert(conf.status === "已失效", "旧确认单失效");

// 8. 待复确认期间禁止流转，即便回阴干/上金粉也不行
assert(R.changeStatus(s, w.id, "待阴干").status === 409, "待复确认禁止转待阴干");
assert(R.changeStatus(s, w.id, "贴线中").status === 409, "待复确认禁止任何流转");

// 9. 重复/并发请求沿用首次
r = R.requestChange(s, { workId: w.id, contact: "王五", reason: "另一个并发请求", version: "v1", theme: "别的", base: "竹胎" });
assert(r.ok && r.reused === true && r.change.id === ch.id, "重复请求沿用首次变更单");
assert(s.changes.length === 1, "没有产生第二份变更单");
assert(ch.contact === "李四" && ch.reason === "客户想换牡丹", "沿用单内容不被覆盖");

// 10. 复确认：生成 v2，旧单只读留档，恢复原工序
r = R.confirmChange(s, ch.id);
assert(r.ok && r.confirmation.version === 2, "复确认生成 v2");
assert(w.status === "待阴干", "恢复到变更前工序（待阴干）");
assert(w.theme === "缠枝牡丹", "新样稿已应用");
assert(R.currentConfirmation(s, w).status === "已确认" && R.currentConfirmation(s, w).id === r.confirmation.id, "作品绑定 v2");
assert(conf.status === "已失效", "v1 保持失效留档");

// 11. 复确认后可继续交付；版本陈旧再次提交 409
assert(R.changeStatus(s, w.id, "待交付").ok, "v2 确认单下可交付");
const stale = R.requestChange(s, { workId: w.id, contact: "李四", reason: "再改", version: "v1", theme: "x" });
assert(stale.status === 409 && stale.code === "VERSION_CONFLICT", "用 v1 旧版本再次改样 409");

// 12. 缺陷追加不覆盖
R.addDefect(s, w.id, "断线 A");
R.addDefect(s, w.id, "翘线 B");
assert(w.defects.length === 2 && w.defects[0].text === "断线 A", "缺陷按时间追加保留");
assert(R.addDefect(s, w.id, "  ").status === 400, "空缺陷拒绝");

// 13. 撤回变更：原确认重新生效
s = newState();
R.createWork(s, { base: "木胎", theme: "梅", line: "细线", dryDate: "d", delivery: "e", contact: "张三" });
const w2 = s.works[0];
const c1 = R.currentConfirmation(s, w2);
R.changeStatus(s, w2.id, "上金粉");
const rc = R.requestChange(s, { workId: w2.id, contact: "李四", reason: "改", version: "v1", base: "竹胎" });
assert(w2.status === "待复确认" && c1.status === "已失效", "改样后旧确认失效");
const rw = R.withdrawChange(s, rc.change.id);
assert(rw.ok && w2.status === "上金粉", "撤回后恢复原工序");
assert(c1.status === "已确认" && R.currentConfirmation(s, w2).id === c1.id, "原确认单重新生效");
assert(s.changes[0].status === "已撤回", "变更单标记已撤回留档");
assert(R.confirmChange(s, rc.change.id).status === 409, "已撤回单不可再确认");
assert(w2.base === "木胎", "撤回后样稿不变");

// 14. 无有效确认单时不能阴干/交付（构造异常态）
s = newState();
R.createWork(s, { base: "b", theme: "t", line: "细线", dryDate: "d", delivery: "e", contact: "c" });
const w3 = s.works[0];
w3.currentConfirmationId = null;
assert(R.changeStatus(s, w3.id, "待交付").status === 409, "无确认单禁止交付");
assert(R.changeStatus(s, w3.id, "贴线中").ok, "无确认单不阻断贴线工序");
assert(R.requestChange(s, { workId: w3.id, contact: "x", reason: "y", version: "v1", theme: "z" }).status === 409, "无确认单禁止登记变更");

// 15. 履历时间线包含所有记录类型
s = newState();
R.createWork(s, { base: "b", theme: "t", line: "细线", dryDate: "d", delivery: "e", contact: "c", initialDefect: "初始缺陷" });
const w4 = s.works[0];
const chg = R.requestChange(s, { workId: w4.id, contact: "x", reason: "y", version: "v1", theme: "t2" });
R.confirmChange(s, chg.change.id);
const hist = R.getHistory(s, w4.id);
assert(hist.some(i => i.kind === "confirmation" && i.version === 1), "履历含 v1 确认");
assert(hist.some(i => i.kind === "confirmation" && i.version === 2), "履历含 v2 确认");
assert(hist.some(i => i.kind === "change"), "履历含变更单");
assert(hist.some(i => i.kind === "defect"), "履历含缺陷");
assert(hist.some(i => i.kind === "log"), "履历含流转记录");
const times = hist.map(i => i.at);
assert(times.every((t, i) => i === 0 || times[i - 1] <= t), "履历按时间升序");

console.log("通过 " + passed + " 项，失败 " + failed + " 项");
process.exit(failed ? 1 : 0);
