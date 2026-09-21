/*
 * storage.js —— 存储层：localStorage 读写、旧数据迁移与示例数据。
 * 唯一持久化入口，规则层不直接接触 localStorage。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "zfl42State.v1";
  const LEGACY_KEY = "zfl42Works";
  const STATE_VERSION = 1;
  const R = window.ZFLRules;

  function now() { return new Date().toISOString(); }
  function nowText() { return new Date().toLocaleString("zh-CN", { hour12: false }); }

  /* 把旧版（作品数组）迁移为新结构：为每件作品补一份 v1 确认单 */
  function migrateLegacy(legacy) {
    const works = [];
    const confirmations = [];
    const changes = [];
    legacy.forEach(function (w) {
      const confirmation = {
        id: R.uid(),
        workId: w.id,
        version: 1,
        snapshot: { base: w.base, theme: w.theme, line: w.line },
        contact: "历史客户（迁移）",
        status: "已确认",
        createdAt: w.createdAt || now(),
        confirmedAt: w.createdAt || now(),
        migrated: true
      };
      const defects = (w.defect || "")
        .split(/[;；]/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(function (text) {
          return { id: R.uid(), at: now(), atText: nowText(), text: text, migrated: true };
        });
      const logs = Array.isArray(w.logs)
        ? w.logs.map(function (text) {
          return { id: R.uid(), at: now(), atText: nowText(), text: String(text), migrated: true };
        })
        : [];
      const work = Object.assign({}, w, {
        currentConfirmationId: confirmation.id,
        defects: defects,
        logs: logs
      });
      delete work.defect;
      confirmations.push(confirmation);
      works.push(work);
    });
    return { version: STATE_VERSION, works: works, confirmations: confirmations, changes: changes };
  }

  function validState(state) {
    return state && Array.isArray(state.works) &&
      Array.isArray(state.confirmations) && Array.isArray(state.changes);
  }

  function seedState() {
    const today = new Date().toISOString().slice(0, 10);
    const state = { version: STATE_VERSION, works: [], confirmations: [], changes: [] };

    R.createWork(state, {
      base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70,
      dryDate: today, gold: "未处理", delivery: "2026-09-26", status: "待阴干",
      contact: "林先生", note: "边线需保持低浮雕感"
    });
    R.createWork(state, {
      base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 95,
      dryDate: "2026-09-20", gold: "试扫粉", delivery: "2026-09-23", status: "上金粉",
      contact: "苏女士", note: "客户要求金粉偏暗", initialDefect: "左侧枝干翘线"
    });
    R.createWork(state, {
      base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40,
      dryDate: "2026-09-24", gold: "未处理", delivery: "2026-09-30", status: "贴线中",
      contact: "陈先生", note: ""
    });

    // 一份待复确认的样例：客户改纹样，作品停在待复确认
    const blocked = R.createWork(state, {
      base: "脱胎花瓶", theme: "缠枝莲", line: "中线", progress: 60,
      dryDate: "2026-09-25", gold: "未处理", delivery: "2026-09-29", status: "上金粉",
      contact: "周女士", note: "客户看样后希望换纹样"
    });
    R.requestChange(state, {
      workId: blocked.work.id, contact: "周女士", reason: "客户认为缠枝莲过于繁复，改缠枝牡丹",
      version: "v1", base: "脱胎花瓶", theme: "缠枝牡丹", line: "中线"
    });

    return state;
  }

  const ZFLStorage = {
    load: function () {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          if (validState(state)) return state;
        }
        // 兼容旧版单键数组结构
        const legacyRaw = localStorage.getItem(LEGACY_KEY);
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw);
          if (Array.isArray(legacy)) {
            const migrated = migrateLegacy(legacy);
            this.save(migrated);
            return migrated;
          }
        }
      } catch (err) {
        console.warn("读取本地数据失败，使用示例数据：", err);
      }
      const seeded = seedState();
      this.save(seeded);
      return seeded;
    },
    save: function (state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    reset: function () {
      const seeded = seedState();
      this.save(seeded);
      return seeded;
    }
  };

  window.ZFLStorage = ZFLStorage;
})();
