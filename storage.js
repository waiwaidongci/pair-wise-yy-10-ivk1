/*
 * storage.js —— 存储层：localStorage 读写、旧版数据迁移、种子数据。
 * 所有变更都经由 rules.js 的规则函数产生，落盘前统一规整，刷新后看板与履历一致。
 */
(function (global) {
  "use strict";

  var R = global.WorkshopRules;
  var STORAGE_KEY = "zfl42WorkshopV1";
  var LEGACY_KEY = "zfl42Works";

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  /* 规整单件作品，补齐各版本字段；旧版 defect 字符串迁移为只追加的缺陷数组。 */
  function normalizeWork(work) {
    if (!work || typeof work !== "object") return null;
    if (!work.id || !work.theme || !work.base || !work.line) return null;

    work.progress = Number(work.progress) || 0;
    work.gold = R.GOLD_STATUSES.indexOf(work.gold) !== -1 ? work.gold : "未处理";
    if (R.ALL_STATUSES.indexOf(work.status) === -1) work.status = "贴线中";
    work.sampleVersion = Number(work.sampleVersion) || 1;
    work.confirmation = work.confirmation || null;
    work.pendingChangeId = work.pendingChangeId || null;
    work.statusBeforeHold = work.statusBeforeHold || null;
    work.logs = asArray(work.logs);
    work.history = asArray(work.history);
    work.defects = asArray(work.defects);

    if (!work.defects.length && work.defect) {
      work.defects = String(work.defect)
        .split(/;\s*/)
        .filter(Boolean)
        .map(function (text) {
          return { id: "legacy-" + work.id + "-" + text.length, text: text, at: "历史记录" };
        });
      delete work.defect;
    }

    return work;
  }

  /* 旧版（单确认单概念之前）数据迁移：为每件作品补一份 v1 样稿确认单。 */
  function migrateLegacy(list) {
    var at = new Date().toLocaleString();
    return asArray(list)
      .map(function (old) {
        var created = normalizeWork({
          id: old.id,
          theme: old.theme,
          base: old.base,
          line: R.LINE_TYPES.indexOf(old.line) !== -1 ? old.line : "中线",
          progress: old.progress,
          dryDate: old.dryDate || R.today(),
          gold: old.gold,
          delivery: old.delivery || R.today(),
          status: old.status,
          note: old.note || "",
          sampleVersion: 1,
          defects: [],
          logs: asArray(old.logs),
          history: []
        });
        if (!created) return null;
        if (old.defect) {
          created.defects = String(old.defect)
            .split(/;\s*/)
            .filter(Boolean)
            .map(function (text) {
              return { id: null, text: text, at: "历史记录" };
            });
        }
        created.history = [
          {
            id: "legacy-v1-" + created.id,
            kind: "初次确认",
            version: 1,
            contact: "历史数据",
            reason: "旧版数据迁移，沿用初次样稿",
            spec: { theme: created.theme, base: created.base, line: created.line },
            status: "已确认",
            createdAt: at,
            confirmedAt: at
          }
        ];
        created.confirmation = {
          id: "legacy-v1-" + created.id,
          version: 1,
          contact: "历史数据",
          reason: "旧版数据迁移，沿用初次样稿",
          spec: { theme: created.theme, base: created.base, line: created.line },
          confirmedAt: at
        };
        created.logs.push(at + " 旧版数据迁移：补登样稿 v1 确认单");
        return created;
      })
      .filter(Boolean);
  }

  function seed() {
    var t = R.today();
    var plus = function (days) {
      return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    };

    // 1. 正常流转：待阴干
    var w1 = R.createWork({
      base: "木胎香盒",
      theme: "海水江崖",
      line: "细线",
      contact: "林客户",
      progress: 70,
      dryDate: t,
      gold: "未处理",
      delivery: plus(5),
      status: "贴线中",
      note: "边线需保持低浮雕感"
    }).work;
    R.transition(w1, "待阴干");

    // 2. 改样后停在待复确认（旧 v1 留档，缺陷记录保留）
    var w2 = R.createWork({
      base: "脱胎盘",
      theme: "折枝梅",
      line: "混合线",
      contact: "陈客户",
      progress: 95,
      dryDate: "2026-09-23",
      gold: "试扫粉",
      delivery: plus(2),
      status: "上金粉",
      defect: "左侧枝干翘线",
      note: "客户要求金粉偏暗"
    }).work;
    R.requestChange(w2, {
      contact: "陈客户",
      version: "v1",
      reason: "客户看样后要求梅枝改为卷草，整体压低浮雕",
      theme: "卷草纹",
      base: "脱胎盘",
      line: "细线"
    });

    // 3. 贴线中，无变更
    var w3 = R.createWork({
      base: "竹胎笔筒",
      theme: "云雷纹",
      line: "中线",
      contact: "王客户",
      progress: 40,
      dryDate: plus(3),
      gold: "未处理",
      delivery: plus(9),
      status: "贴线中"
    }).work;

    // 4. 改样已复确认：v2 生效，v1 只读留档，作品恢复流转
    var w4 = R.createWork({
      base: "木胎漆瓶",
      theme: "缠枝莲",
      line: "粗线",
      contact: "林客户",
      progress: 100,
      dryDate: "2026-09-19",
      gold: "已上金粉",
      delivery: plus(4),
      status: "上金粉"
    }).work;
    R.requestChange(w4, {
      contact: "林客户",
      version: "v1",
      reason: "客户要求花瓣层次加密",
      theme: "缠枝莲",
      base: "木胎漆瓶",
      line: "混合线"
    });
    R.confirmChange(w4);
    R.transition(w4, "待交付");

    return [w1, w2, w3, w4];
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var list = JSON.parse(raw).map(normalizeWork).filter(Boolean);
        if (list.length) return list;
      }
      var legacy = global.localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        var migrated = migrateLegacy(JSON.parse(legacy));
        if (migrated.length) {
          persist(migrated);
          return migrated;
        }
      }
    } catch (error) {
      console.warn("读取本地作品数据失败，使用初始数据", error);
    }
    var initial = seed();
    persist(initial);
    return initial;
  }

  function persist(works) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(works));
  }

  global.WorkshopStorage = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    persist: persist
  };
})(window);
