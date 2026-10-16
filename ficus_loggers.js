/* FICUS loggers: the definitions behind quantified self-tracking, and Manage Loggers, the modal that makes and edits
 * them (the blue tally button under Manage Tags on the Space canvas). Logging values isn't built yet.
 *
 * They're kept in the master backup (ficus_store.js) as two root-level arrays:
 *   logger_groups  [{ id, name }]
 *   loggers        [{ id, name, icon, color, groupId, mode, kind, createdAt, updatedAt, ...the mode's fields }]
 * `icon` is either up to two characters (an emoji or letters; "" shows the name's first letter) or an image
 * URL / data:image from the sticker picker, shown on a tile of `color`. `groupId` is a group's id, or "" for none.
 * `mode` is one of:
 *   "standard"  logged by hand: `inputType` (currency, numeric, tally, boolean, timer, compound or rating), plus
 *               type-specific options. Numeric, currency and tally keep `unit` ("kg", "$", "hours"; may be "").
 *               Other options: `tallyConfig: { step }`, `booleanConfig: { trueLabel, falseLabel }`,
 *               `timerConfig: { mode: "manual"|"stopwatch" }`, `compoundConfig: { fieldALabel, fieldAUnit,
 *               fieldBLabel, fieldBUnit }`, `ratingConfig: { max: 5|10, lowLabel, highLabel }`.
 *   "rollup"    one value made from other loggers': `rollupConfig: { math: "sum" | "average" | "max" | "min" |
 *               "ratio" | "count", targetLoggers: [logger id, ...] }`. For ratio, `targetLoggers` is [numerator,
 *               denominator] (either may be "" until chosen). Count only accepts boolean sources and totals how many
 *               were True. Sum/average/max/min/ratio accept numeric-family inputs and nested roll-ups
 *               (sum/average/max/min/count), but never boolean, compound, or ratio roll-ups.
 * Standard inputs may also have `attachmentConfig: { requirement: "none"|"optional"|"required", allowedTypes:
 * ["photo"|"video"|"audio"|"file"|"album", ...] }`.
 * Every logger may also have `goalConfig` (optional target): numeric shape `{ enabled, operator, targetValue }` for
 * numeric/currency/tally/rating/timer and roll-ups (including count); boolean `{ enabled, operator: "=",
 * targetValue: boolean }`; compound `{ enabled, fieldA: { enabled, operator, targetValue }, fieldB: { ... } }`.
 * `kind` follows the mode: "input" for standard (an Input Logger, the only kind a dot can record values into) and
 * "metric" for roll-ups (a Calculated Metric: read-only, worked out from its sources). A metric may be saved before
 * its sources are connected; until then its value is null, shown as "—".
 * Optional `x` / `y` (numbers) pin the node on the Manage Loggers tree canvas; missing coords are auto-placed and saved.
 * Only the active mode's fields (and the active inputType's config) are kept. A roll-up can't use itself, directly
 * or through other loggers. A saved logger with the old "formula" mode is read as a ratio roll-up (A / B from its
 * variables). Logged numeric values must be >= 0; currency may be negative (`validateLoggedValue`).
 */
(function () {
  "use strict";

  const MODES = [["standard", "Standard Input"], ["rollup", "Calculated Roll-up"]];
  const KINDS = [["input", "Input Logger"], ["metric", "Calculated Metric"]];
  const kindOf = (mode) => (mode === "rollup" ? "metric" : "input");
  const FX = "\u0192";
  const INPUT_TYPES = [
    ["currency", "Currency"], ["numeric", "Numeric"], ["tally", "Tally"], ["boolean", "Boolean"],
    ["timer", "Timer"], ["compound", "Compound"], ["rating", "Rating"],
  ];
  const UNIT_TYPES = new Set(["numeric", "currency", "tally"]);
  const unitPlaceholder = (inputType) => (inputType === "currency" ? "e.g. $, AUD, \u20ac" : "e.g. kg, hours, km");
  const ROLLUP_MATH = [
    ["sum", "Sum"], ["average", "Average"], ["max", "Max"], ["min", "Min"], ["ratio", "Ratio"], ["count", "Count"],
  ];
  const TIMER_MODES = [["manual", "Manual Entry"], ["stopwatch", "Active Stopwatch"]];
  const RATING_SCALES = [["5", "1\u20135"], ["10", "1\u201310"]];
  const GOAL_OPS = [[">", ">"], [">=", "\u2265"], ["=", "="], ["<=", "\u2264"], ["<", "<"]];
  const GOAL_OP_SET = new Set(GOAL_OPS.map(([id]) => id));
  const GOAL_ENABLE = [["off", "No Goal"], ["on", "Set Target"]];
  const ATTACH_REQ = [["none", "None"], ["optional", "Optional"], ["required", "Required"]];
  const ATTACH_TYPES = [
    ["photo", "Photo"], ["video", "Video"], ["audio", "Audio"], ["file", "File"], ["album", "Album"],
  ];
  const ATTACH_TYPE_SET = new Set(ATTACH_TYPES.map(([id]) => id));
  // Standard types allowed under sum/average/max/min/ratio (boolean + compound are excluded).
  const NUMERIC_SOURCE_TYPES = new Set(["numeric", "currency", "tally", "timer", "rating"]);
  // Nested roll-ups allowed as sources for those ops (ratio roll-ups are never nestable).
  const NESTABLE_ROLLUP_MATH = new Set(["sum", "average", "max", "min", "count"]);
  const COLORS = [
    ["Sage", "#8BA888"], ["Mint", "#A3C4BC"], ["Dusty Blue", "#7D98A1"], ["Navy", "#5B6C7E"],
    ["Terracotta", "#CC8B65"], ["Ochre", "#D4A373"], ["Warm Pink", "#D49A89"], ["Plum", "#9D7A8C"],
    ["Neutral", "#A8A39D"], ["Slate", "#6D6A66"],
  ];
  const DEFAULT_COLOR = COLORS[0][1];
  const NAME_MAX = 80;
  const GROUP_MAX = 60;
  const UNIT_MAX = 24;
  const LABEL_MAX = 32;
  const STANDARD_CONFIG_KEYS = ["tallyConfig", "booleanConfig", "timerConfig", "compoundConfig", "ratingConfig"];
  const ICON_IMAGE_RE = /^(data:image\/|https?:\/\/|\/)/i;
  const ICON_IMAGE_MAX = 400000;
  const ICON_IMAGE_PX = 96;
  const STICKER_LIBRARY_URL = "/api/scrapbook/stickers";

  const store = () => window.FicusStore;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const clip = (value, max) => String(value ?? "").trim().slice(0, max);
  const labelOf = (pairs, id) => pairs.find(([key]) => key === id)?.[1] || "";
  const known = (pairs, id) => pairs.some(([key]) => key === id);
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

  // At most two characters as a reader sees them (an emoji made of several code points counts as one).
  function clipIcon(value) {
    const text = String(value ?? "").trim();
    const parts = typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
      : Array.from(text);
    return parts.slice(0, 2).join("");
  }

  const isIconImage = (value) => typeof value === "string" && ICON_IMAGE_RE.test(value.trim());

  // Text/emoji icons stay short; sticker/image icons keep their URL or data:image payload.
  function normalizeIcon(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (isIconImage(text)) return text.slice(0, ICON_IMAGE_MAX);
    return clipIcon(text);
  }

  function shrinkIconImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error("empty image"));
          return;
        }
        const scale = Math.min(1, ICON_IMAGE_PX / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = src;
    });
  }

  /* ---------- The model ---------- */

  function cleanGroup(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    return { ...raw, id: String(raw.id), name: clip(raw.name, GROUP_MAX) || "Untitled group" };
  }

  // A ratio's two slots [numerator, denominator]; missing or self-referencing ids become "".
  function ratioTargets(targets, selfId) {
    const list = Array.isArray(targets) ? targets : [];
    const slot = (value) => {
      if (value == null || value === "") return "";
      const id = String(value);
      return id === selfId ? "" : id;
    };
    return [slot(list[0]), slot(list[1])];
  }

  const cleanTallyConfig = (raw) => {
    const step = Number(isObject(raw) ? raw.step : 1);
    return { step: Number.isFinite(step) && step > 0 ? step : 1 };
  };
  const cleanBooleanConfig = (raw) => {
    const src = isObject(raw) ? raw : {};
    return {
      trueLabel: clip(src.trueLabel, LABEL_MAX) || "Yes",
      falseLabel: clip(src.falseLabel, LABEL_MAX) || "No",
    };
  };
  const cleanTimerConfig = (raw) => ({
    mode: isObject(raw) && raw.mode === "stopwatch" ? "stopwatch" : "manual",
  });
  const cleanCompoundConfig = (raw) => {
    const src = isObject(raw) ? raw : {};
    return {
      fieldALabel: clip(src.fieldALabel, LABEL_MAX),
      fieldAUnit: clip(src.fieldAUnit, UNIT_MAX),
      fieldBLabel: clip(src.fieldBLabel, LABEL_MAX),
      fieldBUnit: clip(src.fieldBUnit, UNIT_MAX),
    };
  };
  const cleanRatingConfig = (raw) => {
    const src = isObject(raw) ? raw : {};
    return {
      max: Number(src.max) === 10 ? 10 : 5,
      lowLabel: clip(src.lowLabel, LABEL_MAX),
      highLabel: clip(src.highLabel, LABEL_MAX),
    };
  };

  const defaultStandardConfigs = () => ({
    tallyConfig: { step: 1 },
    booleanConfig: { trueLabel: "Yes", falseLabel: "No" },
    timerConfig: { mode: "manual" },
    compoundConfig: { fieldALabel: "", fieldAUnit: "", fieldBLabel: "", fieldBUnit: "" },
    ratingConfig: { max: 5, lowLabel: "", highLabel: "" },
  });

  const defaultAttachmentConfig = () => ({ requirement: "none", allowedTypes: [] });

  function cleanAttachmentConfig(raw) {
    const src = isObject(raw) ? raw : {};
    const requirement = src.requirement === "optional" || src.requirement === "required" ? src.requirement : "none";
    const allowedTypes = requirement === "none"
      ? []
      : [...new Set((Array.isArray(src.allowedTypes) ? src.allowedTypes : [])
        .map((type) => String(type))
        .filter((type) => ATTACH_TYPE_SET.has(type)))];
    return { requirement, allowedTypes };
  }

  // Attach only the config that belongs to `inputType`; drop the others so a type switch can't leak.
  function applyStandardConfig(logger, inputType, sources = {}) {
    if (inputType === "tally") logger.tallyConfig = cleanTallyConfig(sources.tallyConfig);
    else if (inputType === "boolean") logger.booleanConfig = cleanBooleanConfig(sources.booleanConfig);
    else if (inputType === "timer") logger.timerConfig = cleanTimerConfig(sources.timerConfig);
    else if (inputType === "compound") logger.compoundConfig = cleanCompoundConfig(sources.compoundConfig);
    else if (inputType === "rating") logger.ratingConfig = cleanRatingConfig(sources.ratingConfig);
  }

  // Which loggers may feed a given math op. Count → booleans only. Other ops → numeric-family inputs plus
  // nestable roll-ups (not ratio, boolean, or compound).
  function isEligibleSource(logger, math) {
    if (!logger) return false;
    if (math === "count") return logger.mode === "standard" && logger.inputType === "boolean";
    if (logger.mode === "standard") return NUMERIC_SOURCE_TYPES.has(logger.inputType);
    if (logger.mode === "rollup") return NESTABLE_ROLLUP_MATH.has(logger.rollupConfig?.math);
    return false;
  }

  function pruneTargetsForMath(math, targets, loggers, selfId) {
    const eligible = new Set(
      loggers
        .filter((logger) => (
          logger.id !== selfId
          && isEligibleSource(logger, math)
          && !(selfId && readsFrom(loggers, logger.id, selfId))
        ))
        .map((logger) => logger.id),
    );
    if (math === "ratio") {
      const list = Array.isArray(targets) ? targets : [];
      return [eligible.has(list[0]) ? list[0] : "", eligible.has(list[1]) ? list[1] : ""];
    }
    return (Array.isArray(targets) ? targets : []).filter((id) => id && eligible.has(id));
  }

  // Goal shape follows mode/inputType: numeric (incl. roll-ups / count), boolean, or compound (per-field targets).
  const goalKindOf = (mode, inputType) => {
    if (mode === "rollup") return "numeric";
    if (inputType === "boolean") return "boolean";
    if (inputType === "compound") return "compound";
    return "numeric";
  };

  function cleanNumericGoalSlot(raw) {
    const src = isObject(raw) ? raw : {};
    const n = Number(src.targetValue);
    return {
      enabled: Boolean(src.enabled),
      operator: GOAL_OP_SET.has(src.operator) ? src.operator : ">=",
      targetValue: Number.isFinite(n) ? n : 0,
    };
  }

  function cleanGoalConfig(raw, kind) {
    if (kind === "boolean") {
      const src = isObject(raw) ? raw : {};
      return {
        enabled: Boolean(src.enabled),
        operator: "=",
        targetValue: src.targetValue === false || src.targetValue === "false" ? false : true,
      };
    }
    if (kind === "compound") {
      const src = isObject(raw) ? raw : {};
      const field = (slot) => {
        const cleaned = cleanNumericGoalSlot(slot);
        return { enabled: cleaned.enabled, operator: cleaned.operator, targetValue: cleaned.targetValue };
      };
      return { enabled: Boolean(src.enabled), fieldA: field(src.fieldA), fieldB: field(src.fieldB) };
    }
    const cleaned = cleanNumericGoalSlot(raw);
    return { enabled: cleaned.enabled, operator: cleaned.operator, targetValue: cleaned.targetValue };
  }

  const defaultGoalConfig = (kind) => cleanGoalConfig(null, kind);

  // Keep enabled/target where the shapes overlap; otherwise start a fresh shape for the new type.
  function adaptGoalConfig(prev, nextKind) {
    const src = isObject(prev) ? prev : {};
    if (nextKind === "boolean") {
      return cleanGoalConfig({
        enabled: src.enabled,
        operator: "=",
        targetValue: typeof src.targetValue === "boolean" ? src.targetValue : true,
      }, "boolean");
    }
    if (nextKind === "compound") {
      if (isObject(src.fieldA) || isObject(src.fieldB)) return cleanGoalConfig(src, "compound");
      const slot = cleanNumericGoalSlot(src);
      return cleanGoalConfig({
        enabled: slot.enabled,
        fieldA: { enabled: slot.enabled, operator: slot.operator, targetValue: slot.targetValue },
        fieldB: { enabled: false, operator: ">=", targetValue: 0 },
      }, "compound");
    }
    if (isObject(src.fieldA)) {
      const slot = cleanNumericGoalSlot(src.fieldA);
      return cleanGoalConfig({
        enabled: Boolean(src.enabled && slot.enabled),
        operator: slot.operator,
        targetValue: slot.targetValue,
      }, "numeric");
    }
    return cleanGoalConfig(src, "numeric");
  }

  const hasActiveGoal = (logger) => {
    const goal = logger?.goalConfig;
    if (!goal?.enabled) return false;
    if (logger.mode === "standard" && logger.inputType === "compound") {
      return Boolean(goal.fieldA?.enabled || goal.fieldB?.enabled);
    }
    return true;
  };

  // A logger in the shape the header describes; fields it doesn't know are kept as they are.
  // An old "formula" logger is read as a ratio roll-up (its A and B variables become the two targets).
  function cleanLogger(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    const {
      inputType, unit, rollupConfig, formulaConfig, goalConfig, attachmentConfig,
      tallyConfig, booleanConfig, timerConfig, compoundConfig, ratingConfig,
      ...rest
    } = raw;
    for (const key of STANDARD_CONFIG_KEYS) delete rest[key];
    delete rest.goalConfig;
    delete rest.attachmentConfig;
    let mode = known(MODES, raw.mode) ? raw.mode : "standard";
    let math = "sum";
    let targets = [];
    if (raw.mode === "formula") {
      mode = "rollup";
      math = "ratio";
      const config = isObject(formulaConfig) ? formulaConfig : {};
      const variables = isObject(config.variables) ? config.variables : {};
      targets = [variables.A, variables.B];
    } else if (mode === "rollup") {
      const config = isObject(rollupConfig) ? rollupConfig : {};
      math = known(ROLLUP_MATH, config.math) ? config.math : "sum";
      targets = Array.isArray(config.targetLoggers) ? config.targetLoggers : [];
    }
    const logger = {
      ...rest,
      id: String(raw.id),
      name: clip(raw.name, NAME_MAX) || "Untitled logger",
      icon: normalizeIcon(raw.icon),
      color: /^#[0-9a-f]{6}$/i.test(raw.color || "") ? raw.color.toUpperCase() : DEFAULT_COLOR,
      groupId: raw.groupId ? String(raw.groupId) : "",
      mode,
      kind: kindOf(mode),
    };
    if (mode === "standard") {
      logger.inputType = known(INPUT_TYPES, inputType) ? inputType : "numeric";
      if (UNIT_TYPES.has(logger.inputType)) logger.unit = clip(unit, UNIT_MAX);
      applyStandardConfig(logger, logger.inputType, {
        tallyConfig, booleanConfig, timerConfig, compoundConfig, ratingConfig,
      });
      logger.attachmentConfig = cleanAttachmentConfig(attachmentConfig);
    } else {
      logger.rollupConfig = {
        math,
        targetLoggers: math === "ratio"
          ? ratioTargets(targets, logger.id)
          : [...new Set(targets.filter((id) => id != null && id !== "").map(String))].filter((id) => id !== logger.id),
      };
    }
    logger.goalConfig = adaptGoalConfig(goalConfig, goalKindOf(logger.mode, logger.inputType));
    delete logger.x;
    delete logger.y;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (Number.isFinite(x)) logger.x = x;
    if (Number.isFinite(y)) logger.y = y;
    return logger;
  }

  // The saved loggers and groups, shape-checked, as fresh objects; a groupId naming no group counts as none.
  function readAll() {
    const saved = store()?.getLoggers?.() || {};
    const groups = [];
    const groupIds = new Set();
    for (const raw of Array.isArray(saved.groups) ? saved.groups : []) {
      const group = cleanGroup(raw);
      if (!group || groupIds.has(group.id)) continue;
      groupIds.add(group.id);
      groups.push(group);
    }
    const loggers = [];
    const ids = new Set();
    for (const raw of Array.isArray(saved.loggers) ? saved.loggers : []) {
      const logger = cleanLogger(raw);
      if (!logger || ids.has(logger.id)) continue;
      if (logger.groupId && !groupIds.has(logger.groupId)) logger.groupId = "";
      ids.add(logger.id);
      loggers.push(logger);
    }
    // Drop sources that don't match each roll-up's math (e.g. a boolean left under Sum).
    for (const logger of loggers) {
      if (logger.mode !== "rollup") continue;
      const { math, targetLoggers } = logger.rollupConfig;
      logger.rollupConfig.targetLoggers = math === "ratio"
        ? pruneTargetsForMath(math, targetLoggers, loggers, logger.id)
        : [...new Set(pruneTargetsForMath(math, targetLoggers, loggers, logger.id))];
    }
    return { loggers, groups };
  }

  // The loggers a roll-up reads from (empty slots in a ratio are skipped).
  function sourcesOf(logger) {
    if (logger.mode !== "rollup") return [];
    return logger.rollupConfig.targetLoggers.filter(Boolean);
  }

  // Whether the logger `fromId` reads from `targetId`, directly or through the loggers it reads from.
  function readsFrom(loggers, fromId, targetId) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const logger = byId.get(id);
      if (!logger) continue;
      for (const source of sourcesOf(logger)) {
        if (source === targetId) return true;
        stack.push(source);
      }
    }
    return false;
  }

  // A roll-up's value from its sources' numbers, or null with none to go on (ratio needs both, and a non-zero B).
  // Count totals how many source values are True (truthy / 1).
  function rollUp(math, numbers) {
    if (math === "count") {
      const list = numbers || [];
      if (!list.length) return null;
      return list.reduce((sum, n) => sum + (n ? 1 : 0), 0);
    }
    const list = (numbers || []).map(Number).filter(Number.isFinite);
    if (math === "ratio") {
      if (list.length < 2 || list[1] === 0) return null;
      return list[0] / list[1];
    }
    if (!list.length) return null;
    if (math === "average") return list.reduce((sum, n) => sum + n, 0) / list.length;
    if (math === "max") return Math.max(...list);
    if (math === "min") return Math.min(...list);
    return list.reduce((sum, n) => sum + n, 0);
  }

  // Shape-check a value before it is written into a standard logger (LogEntryModal calls this).
  function validateLoggedValue(logger, value) {
    if (!logger || logger.mode !== "standard") return { ok: true, value };
    if (logger.inputType === "numeric" || logger.inputType === "tally") {
      if (value == null || value === "") return { ok: false, error: "Enter a number.", value: null };
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: "Enter a number.", value: null };
      if (n < 0) return { ok: false, error: "Must be 0 or greater.", value: null };
      return { ok: true, value: n };
    }
    if (logger.inputType === "currency") {
      if (value == null || value === "") return { ok: false, error: "Enter an amount.", value: null };
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: "Enter an amount.", value: null };
      return { ok: true, value: n };
    }
    if (logger.inputType === "rating") {
      const max = Number(logger.ratingConfig?.max) === 10 ? 10 : 5;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1 || n > max) return { ok: false, error: `Pick 1\u2013${max}.`, value: null };
      return { ok: true, value: n };
    }
    if (logger.inputType === "boolean") {
      if (value === true || value === false) return { ok: true, value };
      return { ok: false, error: "Pick true or false.", value: null };
    }
    if (logger.inputType === "timer") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a duration.", value: null };
      return { ok: true, value: n };
    }
    if (logger.inputType === "compound") {
      const src = value && typeof value === "object" ? value : {};
      const fieldA = Number(src.fieldA);
      const fieldB = Number(src.fieldB);
      if (!Number.isFinite(fieldA) || !Number.isFinite(fieldB)) {
        return { ok: false, error: "Enter both fields.", value: null };
      }
      return { ok: true, value: { fieldA, fieldB } };
    }
    return { ok: true, value };
  }

  // What a metric still lacks: ["sources"] for a multi-source roll-up with none, else "A" and/or "B" for a ratio.
  function pendingOf(logger) {
    if (logger.mode !== "rollup") return [];
    const { math, targetLoggers } = logger.rollupConfig;
    if (math === "ratio") {
      const missing = [];
      if (!targetLoggers[0]) missing.push("A");
      if (!targetLoggers[1]) missing.push("B");
      return missing;
    }
    return targetLoggers.length ? [] : ["sources"];
  }

  /* A logger's value: an input logger's from `values` ({ [logger id]: number }), a metric's worked out from its
     sources in turn (nested roll-ups recurse / memoize so shared leaves run once). null when it can't be (no
     sources yet, no numbers to go on, a loop); formatValue shows that as "—". Empty intermediates yield null, not NaN. */
  function calculate(loggers, id, values = {}) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const memo = new Map();
    const working = new Set();
    const run = (key) => {
      if (memo.has(key)) return memo.get(key);
      const logger = byId.get(key);
      if (!logger || working.has(key)) {
        memo.set(key, null);
        return null;
      }
      if (logger.mode === "standard") {
        const raw = values[key];
        let result = null;
        if (raw != null && raw !== "") {
          if (logger.inputType === "boolean") {
            if (raw === true || raw === 1 || raw === "1" || raw === "true") result = 1;
            else if (raw === false || raw === 0 || raw === "0" || raw === "false") result = 0;
          } else {
            const number = Number(raw);
            result = Number.isFinite(number) ? number : null;
          }
        }
        memo.set(key, result);
        return result;
      }
      working.add(key);
      const { math, targetLoggers } = logger.rollupConfig;
      let result;
      if (math === "ratio") {
        const a = targetLoggers[0] ? run(targetLoggers[0]) : null;
        const b = targetLoggers[1] ? run(targetLoggers[1]) : null;
        result = rollUp("ratio", [a, b].filter((n) => n != null).length === 2 ? [a, b] : []);
      } else if (math === "count") {
        result = rollUp("count", targetLoggers.map(run).filter((n) => n != null));
      } else {
        // Nested children that are pending/empty contribute null and are skipped, not NaN.
        result = rollUp(math, targetLoggers.map(run).filter((n) => n != null && Number.isFinite(Number(n))));
      }
      working.delete(key);
      memo.set(key, result);
      return result;
    };
    return run(id);
  }

  const formatValue = (value) => (value == null || !Number.isFinite(value)
    ? "\u2014"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value));

  // How a logger is filled in: its input type, or how it's worked out.
  function typeLabel(logger) {
    if (logger.mode === "rollup") return `Roll-up \u00b7 ${labelOf(ROLLUP_MATH, logger.rollupConfig.math)}`;
    return labelOf(INPUT_TYPES, logger.inputType);
  }

  // Unit text for a source id from `loggers`, used by the ratio's "Output Unit" line.
  function unitOfId(loggers, id) {
    const logger = loggers.find((row) => row.id === id);
    if (!logger) return "\u2014";
    if (logger.mode === "standard") {
      if (UNIT_TYPES.has(logger.inputType) && logger.unit) return logger.unit;
      return labelOf(INPUT_TYPES, logger.inputType).toLowerCase() || "\u2014";
    }
    if (logger.mode === "rollup" && logger.rollupConfig.math === "ratio") {
      const [a, b] = logger.rollupConfig.targetLoggers;
      return `${unitOfId(loggers, a)} / ${unitOfId(loggers, b)}`;
    }
    return labelOf(ROLLUP_MATH, logger.rollupConfig.math).toLowerCase();
  }

  // The badge text: "Input · Numeric", or "ƒ Roll-up · Sum" for a calculated metric.
  const badgeText = (logger) => (kindOf(logger.mode) === "metric" ? `${FX} ${typeLabel(logger)}` : `Input \u00b7 ${typeLabel(logger)}`);

  /* ---------- The tree ---------- */

  // Node size and spacing in CSS pixels; TOP leaves room for the canvas's group name and + button.
  const NODE_W = 184;
  const NODE_H = 64;
  const GAP_X = 28;
  const GAP_Y = 76;
  const LOOSE_GAP_Y = 18;
  const PAD = 24;
  const TOP = 60;
  const STUB = 24;
  const WORLD_MIN = 4800;
  const TAP_PX = 5;
  const hasCoords = (logger) => Number.isFinite(logger?.x) && Number.isFinite(logger?.y);

  // Orthogonal elbow: bottom-centre of parent → midY → top-centre of child.
  const edgePath = (edge) => {
    const midY = (edge.y1 + edge.y2) / 2;
    return `M${edge.x1} ${edge.y1} L${edge.x1} ${midY} L${edge.x2} ${midY} L${edge.x2} ${edge.y2}`;
  };
  const elbowLabel = (edge) => ({ x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 });

  // Default cascade positions (used only when a logger has no saved x/y yet).
  function autoPositions(nodes, edges, parents, children, isLoose, view) {
    const depth = new Map();
    const visiting = new Set();
    const depthOf = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const value = parents.get(id).reduce((deepest, parent) => Math.max(deepest, depthOf(parent) + 1), 0);
      visiting.delete(id);
      depth.set(id, value);
      return value;
    };
    const tiers = [];
    for (const logger of nodes) if (!isLoose(logger)) (tiers[depthOf(logger.id)] ||= []).push(logger.id);
    const rows = tiers.filter(Boolean);
    const slot = new Map();
    const place = () => rows.forEach((row) => row.forEach((id, i) => slot.set(id, i - (row.length - 1) / 2)));
    const mean = (ids, own) => (ids.length ? ids.reduce((sum, id) => sum + slot.get(id), 0) / ids.length : own);
    place();
    for (let pass = 0; pass < 2; pass += 1) {
      for (let r = 1; r < rows.length; r += 1) {
        rows[r].sort((a, b) => mean(parents.get(a), slot.get(a)) - mean(parents.get(b), slot.get(b)));
        place();
      }
      for (let r = rows.length - 2; r >= 0; r -= 1) {
        rows[r].sort((a, b) => mean(children.get(a), slot.get(a)) - mean(children.get(b), slot.get(b)));
        place();
      }
    }
    const lineWidth = (count) => count * NODE_W + Math.max(0, count - 1) * GAP_X;
    const loose = nodes.filter(isLoose).map((logger) => logger.id);
    const perLine = Math.max(1, Math.floor((view - PAD * 2 + GAP_X) / (NODE_W + GAP_X)));
    const width = Math.max(view, ...rows.map((row) => lineWidth(row.length) + PAD * 2), lineWidth(Math.min(perLine, loose.length || 1)) + PAD * 2);
    const pos = new Map();
    let y = TOP;
    for (const row of rows) {
      const left = (width - lineWidth(row.length)) / 2;
      row.forEach((id, i) => pos.set(id, { x: left + i * (NODE_W + GAP_X), y }));
      y += NODE_H + GAP_Y;
    }
    if (loose.length) {
      const left = (width - lineWidth(Math.min(perLine, loose.length))) / 2;
      if (rows.length) y += 26;
      y += 22;
      loose.forEach((id, i) => {
        const column = i % perLine;
        if (i && !column) y += NODE_H + LOOSE_GAP_Y;
        pos.set(id, { x: left + column * (NODE_W + GAP_X), y });
      });
    }
    return pos;
  }

  /* Group `key`'s loggers on the tree canvas. Saved `x`/`y` win; missing coords get a cascade default and are
     returned in `seeded` so the UI can persist them. Edges are orthogonal elbows (parent bottom → child top). */
  function layoutTree(loggers, key, viewWidth = 0) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const members = loggers.filter((logger) => logger.groupId === key);
    const shown = new Set(members.map((logger) => logger.id));
    const away = new Set();
    const walk = [...members];
    while (walk.length) {
      const logger = walk.pop();
      for (const source of sourcesOf(logger)) {
        if (shown.has(source) || !byId.has(source)) continue;
        shown.add(source);
        const row = byId.get(source);
        if (row.groupId !== key) away.add(source);
        walk.push(row);
      }
    }
    const nodes = [...shown].map((id) => byId.get(id));
    const view = Math.max(viewWidth, NODE_W + PAD * 2);
    if (!nodes.length) {
      return {
        nodes: [], edges: [], stubs: [], seeded: [], width: Math.max(view, WORLD_MIN), height: Math.max(view, WORLD_MIN),
        divider: null, looseLabel: null,
      };
    }

    const edges = [];
    for (const logger of nodes) {
      if (logger.mode !== "rollup") continue;
      const { math, targetLoggers } = logger.rollupConfig;
      if (math === "ratio") {
        [["A", targetLoggers[0]], ["B", targetLoggers[1]]].forEach(([letter, to]) => {
          if (to && shown.has(to)) edges.push({ from: logger.id, to, letter, away: away.has(to) });
        });
      } else {
        for (const to of targetLoggers) if (shown.has(to)) edges.push({ from: logger.id, to, letter: "", away: away.has(to) });
      }
    }
    const parents = new Map(nodes.map((logger) => [logger.id, []]));
    const children = new Map(nodes.map((logger) => [logger.id, []]));
    for (const edge of edges) {
      parents.get(edge.to).push(edge.from);
      children.get(edge.from).push(edge.to);
    }
    const isLoose = (logger) => logger.mode === "standard" && !parents.get(logger.id).length;
    const defaults = autoPositions(nodes, edges, parents, children, isLoose, view);
    const pos = new Map();
    const seeded = [];
    for (const logger of nodes) {
      if (hasCoords(logger)) {
        pos.set(logger.id, { x: logger.x, y: logger.y });
      } else {
        const at = defaults.get(logger.id) || { x: PAD, y: TOP };
        pos.set(logger.id, at);
        seeded.push({ id: logger.id, x: at.x, y: at.y });
      }
    }

    const stubs = [];
    for (const logger of members) {
      for (const item of pendingOf(logger)) {
        stubs.push({ from: logger.id, letter: item === "sources" ? "" : item });
      }
    }
    const attachEdge = (edge) => {
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      edge.x1 = from.x + NODE_W / 2;
      edge.y1 = from.y + NODE_H;
      edge.x2 = to.x + NODE_W / 2;
      edge.y2 = to.y;
      if (edge.letter) edge.label = elbowLabel(edge);
    };
    for (const edge of edges) attachEdge(edge);
    const stubGroups = new Map();
    for (const stub of stubs) (stubGroups.get(stub.from) || stubGroups.set(stub.from, []).get(stub.from)).push(stub);
    for (const [id, list] of stubGroups) {
      const at = pos.get(id);
      list.forEach((stub, i) => {
        stub.x1 = at.x + ((i + 1) * NODE_W) / (list.length + 1);
        stub.y1 = at.y + NODE_H;
      });
    }

    const xs = [...pos.values()].map((at) => at.x);
    const ys = [...pos.values()].map((at) => at.y);
    const maxX = Math.max(...xs.map((x) => x + NODE_W), 0);
    const maxY = Math.max(...ys.map((y) => y + NODE_H), ...stubs.map((stub) => stub.y1 + STUB + 18), 0);
    const width = Math.max(WORLD_MIN, view, maxX + PAD * 4);
    const height = Math.max(WORLD_MIN, maxY + PAD * 4);
    return {
      nodes: nodes.map((logger) => ({ logger, ...pos.get(logger.id), away: away.has(logger.id), loose: isLoose(logger) }))
        .sort((a, b) => a.y - b.y || a.x - b.x),
      edges, stubs, seeded, width, height, divider: null, looseLabel: null,
    };
  }

  /* ---------- Manage Loggers ---------- */

  /* Three parts: the groups down the left (a strip along the top on a phone); the open group's loggers as a zoomable
     freeform tree canvas (layoutTree + saved x/y, orthogonal elbows) on the right; and a floating pop-over form for
     the selected node. A saved logger saves as it's edited and its node follows each change; a new one is a dashed
     node until Create Logger. `groupKey` is the open group's id ("" for No group). `draft` is the pop-over's form,
     null when no node is selected; `selectedId` is its logger's id, null while it's new. `view` is the canvas
     pan/zoom ({ scale, x, y }). `ghostPos` holds x/y for an unsaved dashed node. `quick` is the small form that
     makes an input logger from inside a roll-up's sources or beside a ratio's A/B. */
  const NEW_ID = "__new_logger__";
  const SAVE_PAUSE = 900;
  const VIEW_MIN = 0.4;
  const VIEW_MAX = 2.5;
  const VIEW_STEP = 0.15;
  const ui = {
    groupKey: null,
    selectedId: null,
    draft: null,
    view: { scale: 1, x: 0, y: 0 },
    ghostPos: null, // { x, y } for the unsaved dashed node
    lookPop: null, // null | "color" | "sticker"
    iconMode: "text", // "text" | "sticker"
    groupEdit: null,
    groupConfirm: null,
    confirmDelete: false,
    quick: null,
    saveSeq: 0,
    saveTimer: 0,
    status: { text: "", error: false },
  };
  // Same sticker-library + sheet-slice state as Space's custom icon picker (space.js).
  const stickers = { items: null, loading: null, failed: false, sheet: null, busy: false, status: "" };
  let el = null;
  let lookOutside = null;
  /** @type {Map<number, { x: number, y: number, onNode: boolean }>} */
  let pointers = new Map();
  /** @type {{ dist: number, scale: number, midX: number, midY: number, x: number, y: number } | null} */
  let pinch = null;
  /** @type {{ id: number, x: number, y: number, vx: number, vy: number } | null} */
  let dragPan = null;
  /** Live tree geometry for fast edge redraws while dragging a node. */
  let liveTree = null;
  /** @type {{ pointerId: number, id: string, sx: number, sy: number, ox: number, oy: number, moved: boolean, card: HTMLElement } | null} */
  let nodeDrag = null;

  // Latest scalar per input logger from log_entries (for the tree and roll-up calculate).
  const latestValues = () => window.FicusLogEntries?.latestValues?.() || {};

  // Re-paint the open Manage Loggers tree after a log entry changes.
  function refreshValues() {
    if (!el || el.overlay.classList.contains("hidden")) return;
    const { loggers, groups } = readAll();
    renderTree(loggers, groups);
  }

  function blankDraft(groupId = "") {
    return {
      name: "", icon: "", color: DEFAULT_COLOR, groupId, mode: "standard", inputType: "numeric", unit: "",
      ...defaultStandardConfigs(),
      attachmentConfig: defaultAttachmentConfig(),
      goalConfig: defaultGoalConfig("numeric"),
      math: "sum", targets: [],
    };
  }

  function draftOf(logger) {
    const draft = blankDraft(logger.groupId);
    Object.assign(draft, { name: logger.name, icon: logger.icon, color: logger.color, mode: logger.mode });
    if (logger.mode === "standard") {
      Object.assign(draft, {
        inputType: logger.inputType,
        unit: logger.unit || "",
        tallyConfig: cleanTallyConfig(logger.tallyConfig),
        booleanConfig: cleanBooleanConfig(logger.booleanConfig),
        timerConfig: cleanTimerConfig(logger.timerConfig),
        compoundConfig: cleanCompoundConfig(logger.compoundConfig),
        ratingConfig: cleanRatingConfig(logger.ratingConfig),
        attachmentConfig: cleanAttachmentConfig(logger.attachmentConfig),
      });
    }
    if (logger.mode === "rollup") Object.assign(draft, { math: logger.rollupConfig.math, targets: [...logger.rollupConfig.targetLoggers] });
    draft.goalConfig = cleanGoalConfig(logger.goalConfig, goalKindOf(draft.mode, draft.inputType));
    return draft;
  }

  // Drop configs that don't belong to the new input type so they can't be saved by accident.
  function switchInputType(draft, nextType) {
    const prevKind = goalKindOf(draft.mode, draft.inputType);
    draft.inputType = nextType;
    Object.assign(draft, defaultStandardConfigs());
    if (!UNIT_TYPES.has(nextType)) draft.unit = "";
    const nextKind = goalKindOf(draft.mode, nextType);
    draft.goalConfig = prevKind === nextKind
      ? cleanGoalConfig(draft.goalConfig, nextKind)
      : adaptGoalConfig(draft.goalConfig, nextKind);
  }

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  }

  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) if (value != null && value !== false) node.setAttribute(key, String(value));
    node.append(...children.filter((child) => child != null && child !== false));
    return node;
  }

  const ICONS = {
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.8L10.8 3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L5.8 12.4Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    tally: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5.2 4.5v11M8.4 4.5v11M11.6 4.5v11M14.8 4.5v11M3 13.6 17 6.4"/></svg>',
    face: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.8 9.4c.9 1 2.5 1 3.4 0"/><path d="M6 6.4h.01M10 6.4h.01" stroke-width="2"/></svg>',
    target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2" stroke-linecap="round"/></svg>',
  };
  const icon = (name) => {
    const span = h("span", { class: "logger-svg", "aria-hidden": "true" });
    span.innerHTML = ICONS[name];
    return span;
  };

  // A calculated metric's tile carries a small ƒ in its corner (`fx`), unless something beside it shows the mode.
  function tile(logger, big = false, fx = true) {
    const metric = fx && kindOf(logger.mode) === "metric";
    const image = isIconImage(logger.icon);
    const text = image ? "" : (logger.icon || (logger.name || "?").trim().charAt(0).toUpperCase() || "?");
    return h("span", {
      class: `logger-tile${big ? " is-big" : ""}${metric ? " is-metric" : ""}${image ? " is-image" : ""}`,
      style: `--logger-color:${logger.color}`, "aria-hidden": "true",
    },
    image ? h("img", { src: logger.icon, alt: "", draggable: "false" }) : text,
    metric && h("span", { class: "logger-tile-fx", text: FX }));
  }

  function badge(logger, override) {
    const metric = kindOf(logger.mode) === "metric";
    return h("span", {
      class: `logger-badge is-${logger.mode}${logger.mode === "rollup" && logger.rollupConfig.math === "ratio" ? " is-ratio" : ""}`,
      title: override ? null : metric ? "Calculated metric: worked out from other loggers, read-only" : "Input logger: its values are recorded in dots",
    }, override || badgeText(logger));
  }

  // How a logger reads aloud: "Steps, input logger, tally" / "Total, calculated metric, roll-up · sum, sources pending".
  function rowLabel(logger) {
    const kind = labelOf(KINDS, kindOf(logger.mode)).toLowerCase();
    return `${logger.name}, ${kind}, ${typeLabel(logger).toLowerCase()}${pendingOf(logger).length ? ", sources pending" : ""}`;
  }

  // The operator on a node's corner: a tally for an input logger, Σ x̄ max min # for a roll-up, A:B for a ratio.
  function opMark(logger) {
    if (logger.mode === "standard") return { content: icon("tally"), label: "Input logger" };
    const math = logger.rollupConfig.math;
    if (math === "ratio") return { content: "A:B", label: "Ratio roll-up", word: true };
    if (math === "count") return { content: "#", label: "Count roll-up", word: true };
    return {
      content: { sum: "\u03a3", average: "x\u0304", max: "max", min: "min" }[math],
      label: `${labelOf(ROLLUP_MATH, math)} roll-up`, word: math === "max" || math === "min",
    };
  }

  const groupName = (groups, key) => (key ? groups.find((group) => group.id === key)?.name || "No group" : "No group");

  function init() {
    if (el) return true;
    const overlay = document.getElementById("logger-manager");
    const button = document.getElementById("space-loggers-btn");
    if (!overlay || !button) return false;
    el = {
      overlay,
      button,
      groups: overlay.querySelector("[data-logger-groups]"),
      addGroup: overlay.querySelector("[data-logger-add-group]"),
      stage: overlay.querySelector(".logger-stage"),
      wrap: overlay.querySelector(".logger-canvas-wrap"),
      canvas: overlay.querySelector("[data-logger-canvas]"),
      world: overlay.querySelector("[data-logger-world]"),
      tree: overlay.querySelector("[data-logger-tree]"),
      treeTitle: overlay.querySelector("[data-logger-tree-title]"),
      addNode: overlay.querySelector("[data-logger-new]"),
      zoomIn: overlay.querySelector("[data-zoom-in]"),
      zoomOut: overlay.querySelector("[data-zoom-out]"),
      zoomReset: overlay.querySelector("[data-zoom-reset]"),
      pop: overlay.querySelector("[data-logger-pop]"),
      editor: overlay.querySelector("[data-logger-editor]"),
      laidWidth: 0,
    };
    button.addEventListener("click", open);
    overlay.querySelector("[data-logger-close]").addEventListener("click", () => close());
    el.addNode.addEventListener("click", startNew);
    el.addGroup.addEventListener("click", () => {
      Object.assign(ui, { groupEdit: { id: null }, groupConfirm: null });
      render(() => el.groups.querySelector("[data-group-input]")?.focus());
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener("keydown", onKey);
    el.editor.addEventListener("submit", (event) => {
      event.preventDefault();
      if (ui.selectedId) saveNow();
      else createFromDraft();
    });
    el.pop.addEventListener("pointerdown", (event) => {
      if (event.target === el.pop) deselect();
    });
    bindView();
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (el.overlay.classList.contains("hidden") || el.wrap.clientWidth === el.laidWidth) return;
        const { loggers, groups } = readAll();
        renderTree(loggers, groups);
      }).observe(el.wrap);
    }
    return true;
  }

  function clampScale(scale) {
    return Math.min(VIEW_MAX, Math.max(VIEW_MIN, scale));
  }

  function applyView() {
    const { scale, x, y } = ui.view;
    el.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    el.zoomReset.textContent = `${Math.round(scale * 100)}%`;
  }

  function resetView() {
    ui.view = { scale: 1, x: 0, y: 0 };
    applyView();
  }

  // Zooms around a point in canvas client space (keeps that world point under the cursor/fingers).
  function zoomAt(clientX, clientY, nextScale) {
    const rect = el.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const { scale, x, y } = ui.view;
    const worldX = (cx - x) / scale;
    const worldY = (cy - y) / scale;
    const s = clampScale(nextScale);
    ui.view.scale = s;
    ui.view.x = cx - worldX * s;
    ui.view.y = cy - worldY * s;
    applyView();
  }

  function zoomBy(factor) {
    const rect = el.canvas.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ui.view.scale * factor);
  }

  function pointerDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy) || 1;
  }

  function pointerMid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginPinch() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const mid = pointerMid(pts[0], pts[1]);
    pinch = {
      dist: pointerDist(pts[0], pts[1]),
      scale: ui.view.scale,
      midX: mid.x,
      midY: mid.y,
      x: ui.view.x,
      y: ui.view.y,
    };
    dragPan = null;
    cancelNodeDrag(false);
    el.canvas.classList.add("is-panning");
  }

  function endPointers() {
    pointers.clear();
    pinch = null;
    dragPan = null;
    el.canvas.classList.remove("is-panning");
  }

  // Canvas pan (one finger / mouse on background) and pinch-zoom (two fingers); wheel zooms on desktop.
  function bindView() {
    const coords = (event) => window.FicusInput.getCoordinates(event);
    el.zoomIn.addEventListener("click", () => zoomBy(1 + VIEW_STEP));
    el.zoomOut.addEventListener("click", () => zoomBy(1 / (1 + VIEW_STEP)));
    el.zoomReset.addEventListener("click", resetView);
    el.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAt(event.clientX, event.clientY, ui.view.scale * factor);
    }, { passive: false });
    el.canvas.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      const onNode = Boolean(event.target.closest(".logger-node"));
      const at = coords(event);
      pointers.set(event.pointerId, { x: at.x, y: at.y, onNode });
      if (pointers.size >= 2) {
        cancelNodeDrag(false);
        // Capture both fingers so pinch keeps tracking if one started on a node.
        for (const id of pointers.keys()) {
          try { el.canvas.setPointerCapture(id); } catch (_) { /* ignore */ }
        }
        beginPinch();
        event.preventDefault();
        return;
      }
      if (!onNode) {
        // Background only: capture for pan. Leave node taps uncaptured so click still fires.
        try { el.canvas.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        dragPan = { id: event.pointerId, x: at.x, y: at.y, vx: ui.view.x, vy: ui.view.y };
        el.canvas.classList.add("is-panning");
        event.preventDefault();
      }
    });
    el.canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      const at = coords(event);
      const prev = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: at.x, y: at.y, onNode: prev.onNode });
      if (pointers.size >= 2) {
        if (!pinch) beginPinch();
        const pts = [...pointers.values()];
        const mid = pointerMid(pts[0], pts[1]);
        const dist = pointerDist(pts[0], pts[1]);
        const next = clampScale(pinch.scale * (dist / pinch.dist));
        const rect = el.canvas.getBoundingClientRect();
        const startCx = pinch.midX - rect.left;
        const startCy = pinch.midY - rect.top;
        const worldX = (startCx - pinch.x) / pinch.scale;
        const worldY = (startCy - pinch.y) / pinch.scale;
        const cx = mid.x - rect.left;
        const cy = mid.y - rect.top;
        ui.view.scale = next;
        ui.view.x = cx - worldX * next;
        ui.view.y = cy - worldY * next;
        applyView();
        event.preventDefault();
        return;
      }
      if (dragPan && dragPan.id === event.pointerId) {
        ui.view.x = dragPan.vx + (at.x - dragPan.x);
        ui.view.y = dragPan.vy + (at.y - dragPan.y);
        applyView();
        event.preventDefault();
      }
    });
    const end = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (el.canvas.hasPointerCapture(event.pointerId)) {
        try { el.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      if (pointers.size >= 2) beginPinch();
      else if (pointers.size === 1) {
        pinch = null;
        const [id, pt] = [...pointers.entries()][0];
        if (!pt.onNode) {
          dragPan = { id, x: pt.x, y: pt.y, vx: ui.view.x, vy: ui.view.y };
          el.canvas.classList.add("is-panning");
        } else {
          dragPan = null;
          el.canvas.classList.remove("is-panning");
        }
      } else {
        endPointers();
      }
    };
    el.canvas.addEventListener("pointerup", end);
    el.canvas.addEventListener("pointercancel", end);
    el.canvas.addEventListener("lostpointercapture", (event) => {
      if (pointers.has(event.pointerId)) end(event);
    });
  }

  function syncStage() {
    el.pop.classList.toggle("hidden", !ui.draft);
  }

  function closeLookPops() {
    ui.lookPop = null;
    stickers.status = "";
    if (lookOutside) {
      document.removeEventListener("pointerdown", lookOutside, true);
      lookOutside = null;
    }
    const colorPop = el?.editor.querySelector("[data-logger-color-pop]");
    const stickerPop = el?.editor.querySelector("[data-logger-sticker-pop]");
    colorPop?.classList.add("hidden");
    stickerPop?.classList.add("hidden");
    el?.editor.querySelector("[data-logger-color-btn]")?.setAttribute("aria-expanded", "false");
    el?.editor.querySelector("[data-logger-icon-sticker]")?.setAttribute("aria-expanded", "false");
  }

  function bindLookOutside() {
    if (lookOutside) return;
    lookOutside = (event) => {
      if (event.target.closest(".logger-look, .logger-color-pop, .logger-sticker-pop")) return;
      closeLookPops();
    };
    document.addEventListener("pointerdown", lookOutside, true);
  }

  function placeLookPop(pop, anchor, align = "left") {
    const rect = anchor.getBoundingClientRect();
    pop.classList.remove("hidden");
    const width = pop.offsetWidth || 200;
    const left = align === "right"
      ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  }

  function open() {
    if (!init()) return;
    Object.assign(ui, {
      selectedId: null, draft: null, ghostPos: null, view: { scale: 1, x: 0, y: 0 }, lookPop: null, iconMode: "text",
      groupEdit: null, groupConfirm: null, confirmDelete: false, quick: null, status: { text: "", error: false },
    });
    closeLookPops();
    const { loggers, groups } = readAll();
    if (!groupKeys(loggers, groups).includes(ui.groupKey)) {
      ui.groupKey = groups.find((group) => loggers.some((logger) => logger.groupId === group.id))?.id ?? groupKeys(loggers, groups)[0];
    }
    el.overlay.classList.remove("hidden");
    el.button.setAttribute("aria-expanded", "true");
    applyView();
    render();
    (el.groups.querySelector("[aria-current='true']") || el.addNode)?.focus({ preventScroll: true });
  }

  function close(refocus = true) {
    if (!el || el.overlay.classList.contains("hidden")) return;
    settle();
    el.overlay.classList.add("hidden");
    el.button.setAttribute("aria-expanded", "false");
    if (refocus) el.button.focus({ preventScroll: true });
  }

  // A new logger in the open group: a dashed node, and its form in the pop-over.
  function startNew() {
    settle();
    Object.assign(ui, {
      selectedId: null, draft: blankDraft(ui.groupKey), ghostPos: null, lookPop: null, iconMode: "text", confirmDelete: false, quick: null,
      status: { text: "", error: false },
    });
    closeLookPops();
    render(() => {
      focusNode(NEW_ID, false);
      const name = el.editor.querySelector("[name='name']");
      name?.focus({ preventScroll: true });
      name?.scrollIntoView({ block: "nearest" });
    });
  }

  function select(id) {
    const logger = readAll().loggers.find((row) => row.id === id);
    if (!logger) return;
    settle();
    Object.assign(ui, {
      groupKey: logger.groupId, selectedId: id, draft: draftOf(logger), lookPop: null,
      iconMode: isIconImage(logger.icon) ? "sticker" : "text", confirmDelete: false,
      quick: null, groupConfirm: null, status: { text: "", error: false },
    });
    closeLookPops();
    render(() => focusNode(id));
  }

  function deselect() {
    const id = ui.selectedId;
    settle();
    closeLookPops();
    Object.assign(ui, {
      selectedId: null, draft: null, ghostPos: null, lookPop: null, iconMode: "text", confirmDelete: false, quick: null,
      status: { text: "", error: false },
    });
    render(() => (id && focusNode(id)) || el.addNode.focus({ preventScroll: true }));
  }

  // Focuses a node and pans the view so it sits near the centre of the canvas; false if it isn't in the tree.
  function focusNode(id, focus = true) {
    const node = el.tree.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!node) return false;
    if (focus) node.focus({ preventScroll: true });
    const nx = parseFloat(node.style.left) + NODE_W / 2;
    const ny = parseFloat(node.style.top) + NODE_H / 2;
    const vw = el.canvas.clientWidth;
    const vh = el.canvas.clientHeight;
    ui.view.x = vw / 2 - nx * ui.view.scale;
    ui.view.y = vh / 2 - ny * ui.view.scale;
    applyView();
    return true;
  }

  // The groups that get a pill: every group, and No group while it has loggers (or the pop-over's logger is in it), or
  // while there are no groups.
  function groupKeys(loggers, groups) {
    const keys = groups.map((group) => group.id);
    if (!groups.length || loggers.some((logger) => !logger.groupId) || ui.draft?.groupId === "") keys.push("");
    return keys;
  }

  function settleState(loggers, groups) {
    if (ui.selectedId && !loggers.some((logger) => logger.id === ui.selectedId)) {
      Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false });
    }
    if (ui.quick && ui.quick.mode !== ui.draft?.mode) ui.quick = null;
    const keys = groupKeys(loggers, groups);
    if (!keys.includes(ui.groupKey)) ui.groupKey = keys[0];
  }

  function render(then) {
    const { loggers, groups } = readAll();
    settleState(loggers, groups);
    syncStage();
    renderGroups(loggers, groups);
    renderTree(loggers, groups);
    renderDrawer(loggers, groups);
    then?.();
  }

  // Redraws the groups and the tree only, leaving the pop-over (and whatever is focused in it) alone.
  function refresh() {
    const { loggers, groups } = readAll();
    settleState(loggers, groups);
    syncStage();
    renderGroups(loggers, groups);
    renderTree(loggers, groups);
  }

  // Redraws without moving the form: the pop-over body keeps its scroll, then `selector` (if any) is focused.
  function renderInPlace(selector) {
    const bodyTop = el.editor.querySelector(".logger-editor-body")?.scrollTop || 0;
    render(() => {
      const body = el.editor.querySelector(".logger-editor-body");
      if (body) body.scrollTop = bodyTop;
      const target = selector ? el.editor.querySelector(selector) : null;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    });
  }

  /* ---------- The groups ---------- */

  function renderGroups(loggers, groups) {
    const size = (key) => loggers.filter((logger) => logger.groupId === key).length;
    const items = groupKeys(loggers, groups).map((key) => groupItem(groups.find((group) => group.id === key) || null, size(key)));
    if (ui.groupEdit?.id === null) items.push(h("li", { class: "logger-group is-editing" }, groupNameInput(null)));
    el.groups.replaceChildren(...items);
  }

  // A group's pill; the open group's also has rename and delete (a confirmation replaces it while deleting).
  function groupItem(group, size) {
    const key = group ? group.id : "";
    const name = group ? group.name : "No group";
    const active = key === ui.groupKey;
    if (group && ui.groupEdit?.id === group.id) {
      return h("li", { class: "logger-group is-editing", "data-group-id": key }, groupNameInput(group));
    }
    if (group && ui.groupConfirm === group.id) {
      return h("li", { class: "logger-group is-confirming", "data-group-id": key },
        h("span", { class: "logger-confirm-text", text: size ? `Delete "${name}"? Its loggers move to No group.` : `Delete "${name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", onclick: () => { ui.groupConfirm = null; render(() => focusGroup(key, "delete")); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteGroup(key) }));
    }
    return h("li", { class: `logger-group${active ? " is-active" : ""}`, "data-group-id": key },
      h("button", {
        type: "button", class: "logger-group-pill", "aria-current": active ? "true" : null, "data-group-part": "pick",
        "aria-label": `${name}, ${size} logger${size === 1 ? "" : "s"}`, onclick: () => openGroup(key),
      }, h("span", { class: "logger-group-name", text: name }), h("span", { class: "logger-group-count", "aria-hidden": "true", text: String(size) })),
      active && group && h("span", { class: "logger-group-tools" },
        h("button", {
          type: "button", class: "logger-icon-btn", title: `Rename ${name}`, "aria-label": `Rename ${name}`, "data-group-part": "rename",
          onclick: () => { Object.assign(ui, { groupEdit: { id: key }, groupConfirm: null }); render(() => el.groups.querySelector("[data-group-input]")?.select()); },
        }, icon("pencil")),
        h("button", {
          type: "button", class: "logger-icon-btn", title: `Delete ${name}`, "aria-label": `Delete ${name}`, "data-group-part": "delete",
          onclick: () => { Object.assign(ui, { groupConfirm: key, groupEdit: null }); render(() => el.groups.querySelector(".logger-group.is-confirming .logger-small-btn")?.focus()); },
        }, icon("trash"))));
  }

  function focusGroup(key, part) {
    const target = el.groups.querySelector(`.logger-group[data-group-id="${CSS.escape(key)}"] [data-group-part="${part}"]`);
    target?.focus();
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Opening another group closes the drawer, except on a logger not made yet, which moves along into it.
  function switchGroup(key) {
    settle();
    Object.assign(ui, { groupKey: key, groupConfirm: null });
    if (ui.draft && !ui.selectedId) ui.draft.groupId = key;
    else Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false, quick: null, status: { text: "", error: false } });
  }

  function openGroup(key) {
    if (key === ui.groupKey) return;
    switchGroup(key);
    render(() => focusGroup(key, "pick"));
  }

  // The field that names a new group (group null) or renames one: Enter or leaving it keeps the name, Escape doesn't.
  function groupNameInput(group) {
    let done = false;
    const input = h("input", {
      type: "text", class: "logger-input logger-group-input", maxlength: GROUP_MAX, "data-group-input": "",
      placeholder: "Group name, e.g. Fitness", "aria-label": group ? `Rename ${group.name}` : "New group name", autocomplete: "off",
    });
    input.value = group ? group.name : "";
    const finish = (keep) => {
      if (done) return;
      done = true;
      if (keep) commitGroupName(group, input.value);
      else {
        ui.groupEdit = null;
        render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    return input;
  }

  function commitGroupName(group, value) {
    const name = clip(value, GROUP_MAX);
    const { loggers, groups } = readAll();
    ui.groupEdit = null;
    if (!name || (group && name === group.name)) {
      render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      return;
    }
    if (groups.some((row) => row.id !== group?.id && sameName(row.name, name))) {
      render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      setStatus(`There's already a group called "${name}".`, true);
      return;
    }
    let id = group?.id;
    if (group) groups.find((row) => row.id === group.id).name = name;
    else {
      id = newId("lgrp");
      groups.push({ id, name });
      switchGroup(id);
    }
    persist(loggers, groups, group ? "Group renamed." : "Group added.");
    render(() => focusGroup(id, "pick"));
  }

  function deleteGroup(id) {
    const { loggers, groups } = readAll();
    for (const logger of loggers) if (logger.groupId === id) logger.groupId = "";
    if (ui.draft?.groupId === id) ui.draft.groupId = "";
    if (ui.groupKey === id) ui.groupKey = "";
    ui.groupConfirm = null;
    persist(loggers, groups.filter((group) => group.id !== id), "Group deleted.");
    render(() => el.addGroup.focus());
  }

  /* ---------- The tree canvas ---------- */

  // The saved loggers with the pop-over's changes on top: its logger as it stands, or the new one not made yet.
  function withDraft(loggers) {
    if (!ui.draft) return loggers;
    const { logger } = buildFromDraft(loggers, true);
    return ui.selectedId ? loggers.map((row) => (row.id === logger.id ? logger : row)) : [...loggers, logger];
  }

  // Keeps coords without status chatter (seed on first show, or after a node drag).
  function quietPersist(loggers, groups) {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(() => {
      ui.saveTimer = 0;
      ui.saveSeq += 1;
      Promise.resolve(store()?.flush?.()).catch(() => {});
    }, SAVE_PAUSE);
    return true;
  }

  function seedMissingPositions(seeded) {
    if (!seeded?.length) return;
    const real = seeded.filter((row) => row.id && row.id !== NEW_ID);
    const ghost = seeded.find((row) => row.id === NEW_ID);
    if (ghost) ui.ghostPos = { x: ghost.x, y: ghost.y };
    if (!real.length) return;
    const { loggers, groups } = readAll();
    let dirty = false;
    const next = loggers.map((logger) => {
      const hit = real.find((row) => row.id === logger.id);
      if (!hit || hasCoords(logger)) return logger;
      dirty = true;
      return cleanLogger({ ...logger, x: hit.x, y: hit.y });
    });
    if (dirty) quietPersist(next, groups);
  }

  function saveNodePosition(id, x, y) {
    if (!id || id === NEW_ID) {
      ui.ghostPos = { x, y };
      return;
    }
    const { loggers, groups } = readAll();
    const next = loggers.map((logger) => (
      logger.id === id ? cleanLogger({ ...logger, x, y, updatedAt: new Date().toISOString() }) : logger
    ));
    quietPersist(next, groups);
  }

  function cancelNodeDrag(commit) {
    if (!nodeDrag) return;
    const { card, id, moved, ox, oy } = nodeDrag;
    card.classList.remove("is-dragging");
    el.canvas.classList.remove("is-node-dragging");
    if (commit && moved) {
      const x = parseFloat(card.style.left);
      const y = parseFloat(card.style.top);
      if (liveTree) liveTree.pos.set(id, { x, y });
      saveNodePosition(id, x, y);
      expandTreeBounds();
    } else if (!commit && moved) {
      card.style.left = `${ox}px`;
      card.style.top = `${oy}px`;
      if (liveTree) {
        liveTree.pos.set(id, { x: ox, y: oy });
        redrawLiveEdges(id);
      }
    }
    nodeDrag = null;
  }

  function expandTreeBounds() {
    if (!liveTree || !el?.tree) return;
    let maxX = 0;
    let maxY = 0;
    for (const at of liveTree.pos.values()) {
      maxX = Math.max(maxX, at.x + NODE_W);
      maxY = Math.max(maxY, at.y + NODE_H);
    }
    for (const stub of liveTree.stubs) maxY = Math.max(maxY, stub.y1 + STUB + 18);
    const width = Math.max(WORLD_MIN, el.canvas.clientWidth, maxX + PAD * 4);
    const height = Math.max(WORLD_MIN, maxY + PAD * 4);
    if (width !== liveTree.width || height !== liveTree.height) {
      liveTree.width = width;
      liveTree.height = height;
      el.tree.style.width = `${width}px`;
      el.tree.style.height = `${height}px`;
      el.world.style.minWidth = `${width}px`;
      el.world.style.minHeight = `${height}px`;
      const lines = el.tree.querySelector(".logger-tree-lines");
      if (lines) {
        lines.setAttribute("width", String(width));
        lines.setAttribute("height", String(height));
      }
    }
  }

  function redrawLiveEdges(movedId) {
    if (!liveTree) return;
    const { pos, edges, stubs } = liveTree;
    for (const edge of edges) {
      if (movedId && edge.from !== movedId && edge.to !== movedId) continue;
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      if (!from || !to) continue;
      edge.x1 = from.x + NODE_W / 2;
      edge.y1 = from.y + NODE_H;
      edge.x2 = to.x + NODE_W / 2;
      edge.y2 = to.y;
      edge.pathEl?.setAttribute("d", edgePath(edge));
      if (edge.letter && edge.labelEl) {
        const label = elbowLabel(edge);
        edge.labelEl.querySelector("circle")?.setAttribute("cx", String(label.x));
        edge.labelEl.querySelector("circle")?.setAttribute("cy", String(label.y));
        const text = edge.labelEl.querySelector("text");
        text?.setAttribute("x", String(label.x));
        text?.setAttribute("y", String(label.y));
      }
    }
    for (const stub of stubs) {
      if (movedId && stub.from !== movedId) continue;
      const at = pos.get(stub.from);
      if (!at) continue;
      // Keep relative offset within the node width from initial layout.
      const offset = Number.isFinite(stub.offset) ? stub.offset : 0.5;
      stub.x1 = at.x + offset * NODE_W;
      stub.y1 = at.y + NODE_H;
      const end = stub.y1 + STUB;
      stub.pathEl?.setAttribute("d", `M${stub.x1} ${stub.y1}V${end}`);
      if (stub.endEl) {
        const circle = stub.endEl.querySelector("circle");
        const text = stub.endEl.querySelector("text");
        if (stub.letter) {
          circle?.setAttribute("cx", String(stub.x1));
          circle?.setAttribute("cy", String(end + 8));
          text?.setAttribute("x", String(stub.x1));
          text?.setAttribute("y", String(end + 8));
        } else {
          circle?.setAttribute("cx", String(stub.x1));
          circle?.setAttribute("cy", String(end));
          text?.setAttribute("x", String(stub.x1));
          text?.setAttribute("y", String(end + 12));
        }
      }
    }
  }

  function activateNode(logger, selected) {
    if (logger.id === NEW_ID) el.editor.querySelector("[name='name']")?.focus();
    else if (!selected) select(logger.id);
    else el.editor.querySelector("[name='name']")?.focus();
  }

  function bindNodeDrag(card, logger, selected) {
    const coords = (event) => window.FicusInput.getCoordinates(event);
    let skipClick = false;
    card.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      if (pinch || pointers.size > 1) return;
      const at = coords(event);
      nodeDrag = {
        pointerId: event.pointerId,
        id: logger.id,
        sx: at.x,
        sy: at.y,
        ox: parseFloat(card.style.left) || 0,
        oy: parseFloat(card.style.top) || 0,
        moved: false,
        card,
        selected,
        logger,
      };
      try { card.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      event.stopPropagation();
    });
    card.addEventListener("pointermove", (event) => {
      if (!nodeDrag || nodeDrag.pointerId !== event.pointerId || nodeDrag.card !== card) return;
      if (pinch || pointers.size > 1) {
        cancelNodeDrag(false);
        return;
      }
      const at = coords(event);
      const dist = Math.hypot(at.x - nodeDrag.sx, at.y - nodeDrag.sy);
      if (!nodeDrag.moved && dist < TAP_PX) return;
      nodeDrag.moved = true;
      card.classList.add("is-dragging");
      el.canvas.classList.add("is-node-dragging");
      const x = nodeDrag.ox + (at.x - nodeDrag.sx) / ui.view.scale;
      const y = nodeDrag.oy + (at.y - nodeDrag.sy) / ui.view.scale;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      if (liveTree) {
        liveTree.pos.set(logger.id, { x, y });
        redrawLiveEdges(logger.id);
      }
      event.preventDefault();
    });
    const end = (event) => {
      if (!nodeDrag || nodeDrag.pointerId !== event.pointerId || nodeDrag.card !== card) return;
      const moved = nodeDrag.moved;
      if (card.hasPointerCapture(event.pointerId)) {
        try { card.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      if (moved) {
        skipClick = true;
        cancelNodeDrag(true);
      } else {
        nodeDrag = null;
      }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", (event) => {
      if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) return;
      skipClick = true;
      cancelNodeDrag(false);
    });
    // Tap (< 5px) falls through to click → open editor; a drag suppresses that click.
    card.addEventListener("click", (event) => {
      if (skipClick) {
        skipClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      activateNode(logger, selected);
    });
  }

  function renderTree(loggers, groups) {
    const name = groupName(groups, ui.groupKey);
    el.treeTitle.textContent = name;
    el.addNode.setAttribute("aria-label", `New logger in ${name}`);
    el.addNode.title = `New logger in ${name}`;
    el.laidWidth = el.wrap.clientWidth;
    const shown = withDraft(loggers);
    // Apply ghost position for the unsaved node before layout so it stays put while drafting.
    if (ui.draft && !ui.selectedId && ui.ghostPos) {
      const ghost = shown.find((row) => row.id === NEW_ID);
      if (ghost) Object.assign(ghost, ui.ghostPos);
    }
    const layout = layoutTree(shown, ui.groupKey, el.canvas.clientWidth);
    const focused = el.tree.contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
    nodeDrag = null;
    if (!layout.nodes.length) {
      liveTree = null;
      el.tree.removeAttribute("style");
      el.tree.replaceChildren(h("p", {
        class: "logger-tree-empty", text: `${ui.groupKey ? `No loggers in ${name} yet.` : "No loggers outside a group."} Press + to add one.`,
      }));
      return;
    }
    el.tree.style.cssText = `width:${layout.width}px;height:${layout.height}px`;
    el.world.style.minWidth = `${layout.width}px`;
    el.world.style.minHeight = `${layout.height}px`;
    const selectedKey = ui.draft ? ui.selectedId || NEW_ID : null;
    const context = { loggers: shown, groups, values: latestValues(), selectedKey };
    const lines = drawLines(layout, selectedKey);
    el.tree.replaceChildren(...[
      lines,
      ...layout.nodes.map((node) => nodeCard(node, context)),
    ].filter(Boolean));
    seedMissingPositions(layout.seeded);
    if (focused) el.tree.querySelector(`[data-node-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  function drawLines(layout, selectedKey) {
    const lines = svg("svg", { class: "logger-tree-lines", width: layout.width, height: layout.height, "aria-hidden": "true" });
    const lit = (edge) => edge.from === selectedKey || edge.to === selectedKey;
    const edgeRows = [];
    for (const edge of layout.edges) {
      const pathEl = svg("path", {
        class: `logger-edge${lit(edge) ? " is-lit" : ""}${edge.away ? " is-away" : ""}`,
        d: edgePath(edge),
        "data-from": edge.from,
        "data-to": edge.to,
      });
      lines.append(pathEl);
      edgeRows.push({ ...edge, pathEl, labelEl: null });
    }
    for (const edge of edgeRows) {
      if (!edge.letter) continue;
      const labelEl = svg("g", { class: `logger-edge-letter${lit(edge) ? " is-lit" : ""}` },
        svg("circle", { cx: edge.label.x, cy: edge.label.y, r: 8 }), svg("text", { x: edge.label.x, y: edge.label.y }, edge.letter));
      lines.append(labelEl);
      edge.labelEl = labelEl;
    }
    const stubRows = [];
    for (const stub of layout.stubs) {
      const at = layout.nodes.find((node) => node.logger.id === stub.from);
      const offset = at ? (stub.x1 - at.x) / NODE_W : 0.5;
      const end = stub.y1 + STUB;
      const pathEl = svg("path", { class: "logger-stub", d: `M${stub.x1} ${stub.y1}V${end}` });
      const endEl = stub.letter
        ? svg("g", { class: "logger-stub-end" }, svg("circle", { cx: stub.x1, cy: end + 8, r: 8 }), svg("text", { x: stub.x1, y: end + 8 }, stub.letter))
        : svg("g", { class: "logger-stub-end" }, svg("circle", { cx: stub.x1, cy: end, r: 3 }), svg("text", { class: "is-note", x: stub.x1, y: end + 12 }, "no sources yet"));
      lines.append(pathEl, endEl);
      stubRows.push({ ...stub, offset, pathEl, endEl });
    }
    liveTree = {
      width: layout.width,
      height: layout.height,
      pos: new Map(layout.nodes.map((node) => [node.logger.id, { x: node.x, y: node.y }])),
      edges: edgeRows,
      stubs: stubRows,
    };
    return lines;
  }

  function nodeCard(node, { loggers, groups, values, selectedKey }) {
    const { logger } = node;
    const isNew = logger.id === NEW_ID;
    const selected = logger.id === selectedKey;
    const metric = kindOf(logger.mode) === "metric";
    const pending = !node.away && pendingOf(logger).length > 0;
    const mark = opMark(logger);
    const value = formatValue(calculate(loggers, logger.id, values));
    const home = node.away ? groupName(groups, logger.groupId) : "";
    const sources = new Set(sourcesOf(logger)).size;
    const note = isNew ? "Not created yet"
      : node.away ? `In ${home}`
        : metric ? (logger.rollupConfig.math === "ratio" ? `${unitOfId(loggers, logger.rollupConfig.targetLoggers[0])} / ${unitOfId(loggers, logger.rollupConfig.targetLoggers[1])}` : `from ${sources} logger${sources === 1 ? "" : "s"}`)
          : logger.unit || typeLabel(logger);
    const withGoal = hasActiveGoal(logger);
    const label = [rowLabel(logger), value === "\u2014" ? "no value yet" : `value ${value}`, node.away && `in ${home}`, isNew && "not created yet", withGoal && "has a goal"]
      .filter(Boolean).join(", ");
    const card = h("button", {
      type: "button",
      class: `logger-node is-${logger.mode}${logger.mode === "rollup" && logger.rollupConfig.math === "ratio" ? " is-ratio" : ""}${selected ? " is-selected" : ""}${node.away ? " is-away" : ""}${isNew ? " is-new" : ""}${withGoal ? " has-goal" : ""}`,
      style: `left:${node.x}px;top:${node.y}px;width:${NODE_W}px;height:${NODE_H}px;--logger-color:${logger.color}`,
      "data-node-id": logger.id, "aria-current": selected ? "true" : null, "aria-label": label,
    },
    h("span", { class: `logger-node-op${mark.word ? " is-word" : ""}`, title: mark.label, "aria-hidden": "true" }, mark.content),
    withGoal && h("span", { class: "logger-node-goal", title: "Has a goal", "aria-hidden": "true" }, icon("target")),
    tile(logger, false, false),
    h("span", { class: "logger-node-text" },
      h("span", { class: "logger-node-name", text: logger.name }),
      h("span", { class: "logger-node-value" }, h("strong", { text: value }),
        pending
          ? h("span", { class: "logger-pending", title: "Not connected to its sources yet: it shows \u2014 until it is", text: "Pending" })
          : h("span", { class: "logger-node-note", text: note }))));
    bindNodeDrag(card, logger, selected);
    return card;
  }

  /* ---------- The floating pop-over editor ---------- */

  function loadStickerLibrary() {
    if (stickers.items) return Promise.resolve(stickers.items);
    if (!stickers.loading) {
      stickers.failed = false;
      stickers.loading = fetch(STICKER_LIBRARY_URL)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`sticker library ${res.status}`))))
        .then((items) => {
          stickers.items = Array.isArray(items) ? items.filter((item) => typeof item?.src === "string" && item.src) : [];
        })
        .catch(() => { stickers.failed = true; })
        .finally(() => { stickers.loading = null; });
    }
    return stickers.loading;
  }

  function field(labelText, control, hint) {
    const id = control.id || (control.id = `logger-field-${Math.random().toString(36).slice(2, 8)}`);
    return h("div", { class: "logger-field" }, h("label", { class: "logger-label", for: id, text: labelText }), control, hint && h("p", { class: "logger-hint", text: hint }));
  }

  function selectBox(name, options, value, onchange) {
    const box = h("select", { class: "logger-input", name, onchange });
    for (const [id, text] of options) box.append(h("option", { value: id, text }));
    box.value = value;
    return box;
  }

  const statusLine = () => h("p", { class: `logger-status${ui.status.error ? " is-error" : ""}`, role: "status", "data-logger-status": "", text: ui.status.text });

  function renderDrawer(loggers, groups) {
    const draft = ui.draft;
    if (!draft) {
      closeLookPops();
      el.editor.replaceChildren();
      return;
    }

    const editing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const others = loggers.filter((logger) => logger.id !== ui.selectedId);
    // Ancestors at any depth (parents, grandparents, …): selecting them as a source would loop.
    const loops = new Set(editing ? others.filter((logger) => readsFrom(loggers, logger.id, editing.id)).map((logger) => logger.id) : []);
    const users = editing ? others.filter((logger) => sourcesOf(logger).includes(editing.id)) : [];
    // Eligible by math type; loop candidates stay in the checklist but are disabled below.
    const sourcePool = (math) => others.filter((logger) => isEligibleSource(logger, math));
    const heading = h("h3", {
      class: "logger-editor-title", tabindex: "-1", "data-logger-heading": "",
      text: editing ? `Edit ${editing.name}` : `New Logger in ${groupName(groups, draft.groupId)}`,
    });
    if (ui.iconMode !== "text" && ui.iconMode !== "sticker") ui.iconMode = isIconImage(draft.icon) ? "sticker" : "text";
    if (isIconImage(draft.icon)) ui.iconMode = "sticker";

    const look = h("div", { class: "logger-look" });
    const colorBtn = h("button", {
      type: "button", class: "logger-color-btn", "data-logger-color-btn": "",
      style: `--swatch:${draft.color}`, "aria-label": "Colour", title: "Colour",
      "aria-expanded": String(ui.lookPop === "color"), "aria-haspopup": "true",
    });
    const syncPreview = () => {
      colorBtn.style.setProperty("--swatch", draft.color);
      colorBtn.replaceChildren(
        isIconImage(draft.icon)
          ? h("img", { src: draft.icon, alt: "", draggable: "false" })
          : h("span", { class: "logger-color-glyph", text: draft.icon || (draft.name || "?").trim().charAt(0).toUpperCase() || "?" }),
      );
    };
    syncPreview();

    const name = h("input", {
      type: "text", class: "logger-input", name: "name", maxlength: NAME_MAX, placeholder: "e.g. Body weight", autocomplete: "off",
      oninput: (event) => {
        draft.name = event.target.value;
        if (editing) heading.textContent = `Edit ${clip(draft.name, NAME_MAX) || editing.name}`;
        syncPreview();
        changed();
      },
    });
    name.value = draft.name;

    const iconField = h("input", {
      type: "text", class: "logger-input logger-icon-input", name: "icon", placeholder: "Aa", autocomplete: "off",
      "aria-label": "Text or emoji icon", "aria-describedby": "logger-icon-hint",
      oninput: (event) => {
        const clipped = clipIcon(event.target.value);
        if (clipped !== event.target.value.trim()) event.target.value = clipped;
        draft.icon = clipped;
        ui.iconMode = "text";
        syncMode();
        syncPreview();
        changed();
      },
    });
    iconField.value = isIconImage(draft.icon) ? "" : draft.icon;

    const colorPop = h("div", {
      class: `logger-color-pop${ui.lookPop === "color" ? "" : " hidden"}`, "data-logger-color-pop": "",
      role: "radiogroup", "aria-label": "Colour",
    }, COLORS.map(([colorName, hex]) => h("button", {
      type: "button", class: "logger-swatch", role: "radio", "aria-checked": String(draft.color === hex),
      "aria-label": colorName, title: colorName, style: `--swatch:${hex}`,
      onclick: (event) => {
        draft.color = hex;
        for (const swatch of colorPop.children) swatch.setAttribute("aria-checked", String(swatch === event.currentTarget));
        syncPreview();
        changed();
        closeLookPops();
      },
    })));

    const textModeBtn = h("button", {
      type: "button", class: "logger-icon-mode", "data-logger-icon-text": "", role: "radio",
      "aria-checked": String(ui.iconMode === "text"), "aria-label": "Text or emoji icon", title: "Text / emoji",
      text: "Aa",
      onclick: () => {
        ui.iconMode = "text";
        if (isIconImage(draft.icon)) {
          draft.icon = "";
          changed();
        }
        closeLookPops();
        syncMode();
        syncPreview();
        iconField.focus({ preventScroll: true });
      },
    });
    const stickerModeBtn = h("button", {
      type: "button", class: "logger-icon-mode", "data-logger-icon-sticker": "", role: "radio",
      "aria-checked": String(ui.iconMode === "sticker"), "aria-expanded": String(ui.lookPop === "sticker"),
      "aria-haspopup": "true", "aria-label": "Sticker icon", title: "Sticker / image",
      onclick: () => {
        ui.iconMode = "sticker";
        syncMode();
        if (ui.lookPop === "sticker") closeLookPops();
        else openStickerPop();
      },
    }, icon("face"));

    const iconModes = h("div", { class: "logger-icon-modes", role: "radiogroup", "aria-label": "Icon type" }, textModeBtn, stickerModeBtn);

    const stickerPop = h("div", {
      class: `logger-sticker-pop space-pop space-icon-pop${ui.lookPop === "sticker" ? "" : " hidden"}`,
      "data-logger-sticker-pop": "", role: "dialog", "aria-label": "Sticker icon",
    });

    const fillStickerPop = () => {
      let library;
      if (stickers.items?.length) {
        library = h("div", { class: "space-icon-grid" }, stickers.items.map((item) => h("button", {
          type: "button", class: "space-icon-tile", title: item.name || "Sticker",
          onclick: () => useStickerSrc(item.src),
        }, h("img", { src: item.src, alt: "", loading: "lazy" }))));
      } else if (stickers.items) {
        library = h("p", { class: "space-icon-note", text: "No saved stickers yet. Upload one above, or add sticker sheets in a Vision scrapbook." });
      } else if (stickers.failed) {
        library = h("p", { class: "space-icon-note", text: "Couldn\u2019t load your sticker library." });
      } else {
        library = h("p", { class: "space-icon-note", text: "Loading your stickers\u2026" });
      }
      const file = h("input", { type: "file", accept: "image/*", "data-logger-sticker-file": "", hidden: true });
      file.addEventListener("change", () => {
        importStickerFile(file.files?.[0]);
        file.value = "";
      });
      stickerPop.replaceChildren(
        h("p", { class: "space-pop-label", text: "Sticker icon" }),
        h("button", {
          type: "button", class: "space-icon-upload", disabled: stickers.busy || null,
          onclick: () => file.click(),
        }, h("span", { "aria-hidden": "true", text: "\u21eb" }), stickers.busy ? "Slicing\u2026" : "Upload an icon or sticker sheet"),
        file,
        stickers.status && h("p", { class: "space-icon-note is-status", text: stickers.status }),
        stickers.sheet && h("p", { class: "space-pop-label", text: "From your sheet" }),
        stickers.sheet && h("div", { class: "space-icon-grid" }, stickers.sheet.map((src) => h("button", {
          type: "button", class: "space-icon-tile", title: "Use this sticker", onclick: () => useStickerSrc(src),
        }, h("img", { src, alt: "" })))),
        h("p", { class: "space-pop-label", text: "Your stickers" }),
        library,
      );
    };

    const useStickerSrc = async (src) => {
      if (stickers.busy) return;
      stickers.busy = true;
      fillStickerPop();
      try {
        draft.icon = normalizeIcon(await shrinkIconImage(src));
        ui.iconMode = "sticker";
        stickers.busy = false;
        stickers.status = "";
        syncMode();
        syncPreview();
        changed();
        closeLookPops();
      } catch (_) {
        stickers.busy = false;
        stickers.status = "Couldn\u2019t use that image. Try another one.";
        fillStickerPop();
      }
    };

    // Same auto-slice path as Space custom icons: JotScrapbook.sliceStickerSheet, then pick a piece.
    const importStickerFile = async (file) => {
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        stickers.status = "Choose a PNG, JPG, GIF or WebP image.";
        fillStickerPop();
        return;
      }
      const kit = window.JotScrapbook;
      stickers.busy = true;
      stickers.status = "";
      stickers.sheet = null;
      fillStickerPop();
      try {
        const src = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        let pieces = [];
        if (typeof kit?.sliceStickerSheet === "function") {
          const sliced = await kit.sliceStickerSheet(src, { maxPx: kit.STICKER_ASSET_MAX_PX || 420, minAreaFrac: 0.0012 });
          pieces = typeof kit.looksLikeCaption === "function" ? sliced.filter((piece) => !kit.looksLikeCaption(piece, sliced)) : sliced;
        }
        stickers.busy = false;
        if (pieces.length <= 1) {
          await useStickerSrc(pieces[0]?.src || src);
          return;
        }
        stickers.sheet = pieces.slice(0, 60).map((piece) => piece.src);
        stickers.status = `Found ${pieces.length} stickers. Pick one.`;
      } catch (_) {
        stickers.busy = false;
        stickers.status = "Couldn\u2019t read that image. Try a PNG or JPG.";
      }
      fillStickerPop();
    };

    const openStickerPop = () => {
      ui.lookPop = "sticker";
      colorPop.classList.add("hidden");
      colorBtn.setAttribute("aria-expanded", "false");
      stickerModeBtn.setAttribute("aria-expanded", "true");
      fillStickerPop();
      placeLookPop(stickerPop, stickerModeBtn, "right");
      bindLookOutside();
      if (!stickers.items) {
        loadStickerLibrary().then(() => {
          if (ui.lookPop !== "sticker") return;
          fillStickerPop();
          placeLookPop(stickerPop, stickerModeBtn, "right");
        });
      }
    };

    const openColorPop = () => {
      ui.lookPop = "color";
      stickerPop.classList.add("hidden");
      stickerModeBtn.setAttribute("aria-expanded", "false");
      colorBtn.setAttribute("aria-expanded", "true");
      placeLookPop(colorPop, colorBtn, "left");
      bindLookOutside();
    };

    colorBtn.addEventListener("click", () => {
      if (ui.lookPop === "color") closeLookPops();
      else openColorPop();
    });

    const syncMode = () => {
      textModeBtn.setAttribute("aria-checked", String(ui.iconMode === "text"));
      stickerModeBtn.setAttribute("aria-checked", String(ui.iconMode === "sticker"));
      iconField.hidden = ui.iconMode !== "text";
    };
    syncMode();
    fillStickerPop();
    look.append(colorBtn, iconModes, iconField, colorPop, stickerPop);
    if (ui.lookPop === "color" || ui.lookPop === "sticker") {
      requestAnimationFrame(() => {
        if (ui.lookPop === "color") placeLookPop(colorPop, colorBtn, "left");
        else if (ui.lookPop === "sticker") placeLookPop(stickerPop, stickerModeBtn, "right");
        bindLookOutside();
      });
    }

    const group = selectBox("group", [["", "No group"], ...groups.map((row) => [row.id, row.name])], draft.groupId, (event) => { draft.groupId = event.target.value; changed(); });

    // Standard Input | Calculated Roll-up.
    const modes = h("div", { class: "logger-modes", role: "radiogroup", "aria-label": "Mode" },
      h("div", { class: "logger-mode-row" }, MODES.map(([id, text]) => h("button", {
        type: "button", class: "logger-mode", role: "radio", "aria-checked": String(draft.mode === id), "data-mode": id, text,
        "aria-description": labelOf(KINDS, kindOf(id)),
        onclick: () => {
          if (draft.mode === id) return;
          const prevKind = goalKindOf(draft.mode, draft.inputType);
          draft.mode = id;
          const nextKind = goalKindOf(draft.mode, draft.inputType);
          if (prevKind !== nextKind) draft.goalConfig = adaptGoalConfig(draft.goalConfig, nextKind);
          else draft.goalConfig = cleanGoalConfig(draft.goalConfig, nextKind);
          setStatus("");
          changed();
          renderInPlace(`[data-mode="${id}"]`);
        },
      }))));
    const kindNote = kindOf(draft.mode) === "metric"
      ? h("p", { class: "logger-kind-note is-metric" }, h("span", { class: "logger-fx", "aria-hidden": "true", text: FX }), " ",
        h("strong", { text: "Calculated metric." }), " Read-only until its sources are connected.")
      : h("p", { class: "logger-kind-note" }, h("strong", { text: "Input logger." }), " Values are recorded in dots.");

    let modePanel;
    if (draft.mode === "standard") {
      const type = selectBox("inputType", INPUT_TYPES, draft.inputType, (event) => {
        switchInputType(draft, event.target.value);
        changed();
        renderInPlace("[name='inputType']");
      });
      const unitInput = () => {
        const unit = h("input", {
          type: "text", class: "logger-input", name: "unit", maxlength: UNIT_MAX, autocomplete: "off",
          placeholder: unitPlaceholder(draft.inputType),
          oninput: (event) => { draft.unit = event.target.value; changed(); },
        });
        unit.value = draft.unit || "";
        return unit;
      };
      const textInput = (name, value, max, oninput, placeholder = "") => {
        const input = h("input", {
          type: "text", class: "logger-input", name, maxlength: max, autocomplete: "off", placeholder,
          oninput: (event) => oninput(event.target.value),
        });
        input.value = value;
        return input;
      };
      let settings;
      if (draft.inputType === "numeric" || draft.inputType === "currency") {
        settings = h("div", { class: "logger-pair" }, field("Unit Label", unitInput()));
      } else if (draft.inputType === "tally") {
        const step = h("input", {
          type: "number", class: "logger-input", name: "tally-step", min: "0.01", step: "any", inputmode: "decimal",
          oninput: (event) => {
            const n = Number(event.target.value);
            draft.tallyConfig.step = Number.isFinite(n) && n > 0 ? n : draft.tallyConfig.step;
            changed();
          },
        });
        step.value = String(draft.tallyConfig.step ?? 1);
        settings = h("div", { class: "logger-pair" },
          field("Step Size", step),
          field("Unit Label", unitInput()));
      } else if (draft.inputType === "boolean") {
        settings = h("div", { class: "logger-pair" },
          field("True Label", textInput("bool-true", draft.booleanConfig.trueLabel, LABEL_MAX, (v) => {
            draft.booleanConfig.trueLabel = v; changed();
          }, "Yes")),
          field("False Label", textInput("bool-false", draft.booleanConfig.falseLabel, LABEL_MAX, (v) => {
            draft.booleanConfig.falseLabel = v; changed();
          }, "No")));
      } else if (draft.inputType === "timer") {
        const mode = selectBox("timer-mode", TIMER_MODES, draft.timerConfig.mode, (event) => {
          draft.timerConfig.mode = event.target.value === "stopwatch" ? "stopwatch" : "manual";
          changed();
        });
        settings = field("Tracking Mode", mode);
      } else if (draft.inputType === "compound") {
        settings = [
          h("div", { class: "logger-pair" },
            field("Field A Name", textInput("compound-a-name", draft.compoundConfig.fieldALabel, LABEL_MAX, (v) => {
              draft.compoundConfig.fieldALabel = v; changed();
            }, "e.g. Sets")),
            field("Field A Unit", textInput("compound-a-unit", draft.compoundConfig.fieldAUnit, UNIT_MAX, (v) => {
              draft.compoundConfig.fieldAUnit = v; changed();
            }))),
          h("div", { class: "logger-pair" },
            field("Field B Name", textInput("compound-b-name", draft.compoundConfig.fieldBLabel, LABEL_MAX, (v) => {
              draft.compoundConfig.fieldBLabel = v; changed();
            }, "e.g. Reps")),
            field("Field B Unit", textInput("compound-b-unit", draft.compoundConfig.fieldBUnit, UNIT_MAX, (v) => {
              draft.compoundConfig.fieldBUnit = v; changed();
            }))),
        ];
      } else if (draft.inputType === "rating") {
        const scale = selectBox("rating-max", RATING_SCALES, String(draft.ratingConfig.max), (event) => {
          draft.ratingConfig.max = event.target.value === "10" ? 10 : 5;
          changed();
        });
        settings = [
          field("Scale", scale),
          h("div", { class: "logger-pair" },
            field("Low Label", textInput("rating-low", draft.ratingConfig.lowLabel, LABEL_MAX, (v) => {
              draft.ratingConfig.lowLabel = v; changed();
            }, "optional")),
            field("High Label", textInput("rating-high", draft.ratingConfig.highLabel, LABEL_MAX, (v) => {
              draft.ratingConfig.highLabel = v; changed();
            }, "optional"))),
        ];
      }
      modePanel = [
        field("Input Type", type),
        settings && h("div", { class: "logger-type-settings" }, ...(Array.isArray(settings) ? settings : [settings])),
      ].filter(Boolean);
    } else {
      if (draft.math === "ratio" && draft.targets.length < 2) draft.targets = [draft.targets[0] || "", draft.targets[1] || ""];
      draft.targets = pruneTargetsForMath(draft.math, draft.targets, loggers, ui.selectedId || "");
      const ratioPicks = [["", "Choose a logger\u2026"], ...sourcePool(draft.math)
        .filter((logger) => !loops.has(logger.id))
        .map((logger) => [logger.id, `${logger.name} (${badgeText(logger)})`])];
      const math = selectBox("math", ROLLUP_MATH, draft.math, (event) => {
        draft.math = event.target.value;
        if (draft.math === "ratio") draft.targets = [draft.targets[0] || "", draft.targets[1] || ""];
        else draft.targets = draft.targets.filter(Boolean);
        draft.targets = pruneTargetsForMath(draft.math, draft.targets, loggers, ui.selectedId || "");
        changed();
        renderInPlace("[name='math']");
      });
      const mathHint = draft.math === "count"
        ? h("p", { class: "logger-hint", text: "Counts the total number of times the source loggers were marked as True." })
        : null;
      if (draft.math === "ratio") {
        const setSlot = (index, value) => {
          draft.targets = ratioTargets([index === 0 ? value : draft.targets[0], index === 1 ? value : draft.targets[1]], ui.selectedId || "");
          draft.targets = pruneTargetsForMath("ratio", draft.targets, loggers, ui.selectedId || "");
          changed();
        };
        const slotRow = (letter, index) => {
          const making = ui.quick?.mode === "rollup" && ui.quick.letter === letter;
          const pick = selectBox(`ratio-${letter}`, ratioPicks, draft.targets[index] || "", (event) => setSlot(index, event.target.value));
          if (pick.value !== (draft.targets[index] || "")) {
            pick.value = "";
            draft.targets[index] = "";
          }
          pick.setAttribute("aria-label", letter === "A" ? "Numerator (A)" : "Denominator (B)");
          const row = h("div", { class: "logger-var" },
            h("span", { class: "logger-var-letter", "aria-hidden": "true", text: letter }),
            pick,
            h("button", {
              type: "button", class: "logger-text-btn logger-var-new", "data-quick-open": letter, "aria-expanded": String(making),
              "aria-label": `Add a source logger for ${letter}`, title: `Add a source logger for ${letter}`, text: "+ Add",
              onclick: () => (making ? closeQuick() : openQuick(letter)),
            }));
          return making ? [row, quickForm(groups)] : [row];
        };
        const aUnit = unitOfId(loggers, draft.targets[0]);
        const bUnit = unitOfId(loggers, draft.targets[1]);
        modePanel = [
          field("Math Operation", math),
          mathHint,
          h("fieldset", { class: "logger-field logger-sources" },
            h("legend", { class: "logger-label", text: "Ratio" }),
            h("p", { class: "logger-hint", text: "Numerator (A) \u00f7 Denominator (B)." }),
            h("div", { class: "logger-vars" }, ...slotRow("A", 0), ...slotRow("B", 1)),
            h("p", {
              class: "logger-ratio-unit", role: "status",
              text: `Output Unit: ${aUnit} / ${bUnit}`,
            })),
        ].filter(Boolean);
      } else {
        const eligible = sourcePool(draft.math);
        const checks = eligible.map((logger) => {
          const blocked = loops.has(logger.id);
          const box = h("input", {
            type: "checkbox", value: logger.id, disabled: blocked,
            onchange: (event) => {
              const set = new Set(draft.targets.filter(Boolean));
              if (event.target.checked) set.add(logger.id);
              else set.delete(logger.id);
              draft.targets = eligible.map((row) => row.id).filter((id) => set.has(id) && !loops.has(id));
              changed();
            },
          });
          box.checked = draft.targets.includes(logger.id) && !blocked;
          return h("label", {
            class: `logger-check${blocked ? " is-blocked" : ""}`,
            title: blocked ? "Circular reference: it already depends on this logger" : null,
          },
          box, tile(logger), h("span", { class: "logger-row-name", text: logger.name }),
          badge(logger, blocked ? "Circular reference" : null));
        });
        const emptyHint = draft.math === "count"
          ? "No boolean loggers to count yet. Add one here, or keep this roll-up and connect them later."
          : "No numeric loggers or nestable roll-ups to combine yet. Add one here, or keep this roll-up and connect its sources later.";
        modePanel = [
          field("Math Operation", math),
          mathHint,
          h("fieldset", { class: "logger-field logger-sources" }, h("legend", { class: "logger-label", text: "Data Sources" }),
            checks.length
              ? h("div", { class: "logger-checks" }, checks)
              : h("p", { class: "logger-hint", text: emptyHint }),
            ui.quick?.mode === "rollup" && !ui.quick.letter
              ? quickForm(groups)
              : h("button", { type: "button", class: "logger-add-source", "data-quick-open": "rollup", "aria-expanded": "false", text: "+ Add Source", onclick: () => openQuick("") })),
        ].filter(Boolean);
      }
    }

    let attachSection = null;
    if (draft.mode === "standard") {
      draft.attachmentConfig = cleanAttachmentConfig(draft.attachmentConfig);
      const attachToggle = h("div", { class: "logger-modes logger-attach-toggle", role: "radiogroup", "aria-label": "Attachments" },
        h("div", { class: "logger-mode-row is-triple" }, ATTACH_REQ.map(([id, text]) => h("button", {
          type: "button", class: "logger-mode", role: "radio",
          "aria-checked": String(draft.attachmentConfig.requirement === id),
          "data-attach-req": id, text,
          onclick: () => {
            if (draft.attachmentConfig.requirement === id) return;
            draft.attachmentConfig.requirement = id;
            if (id === "none") draft.attachmentConfig.allowedTypes = [];
            changed();
            renderInPlace(`[data-attach-req="${id}"]`);
          },
        }))));
      const typePills = draft.attachmentConfig.requirement === "none" ? null : h("div", {
        class: "logger-attach-types", role: "group", "aria-label": "Allowed attachment types",
      }, ATTACH_TYPES.map(([id, text]) => {
        const on = draft.attachmentConfig.allowedTypes.includes(id);
        return h("button", {
          type: "button", class: `logger-attach-pill${on ? " is-on" : ""}`, "aria-pressed": String(on), text,
          onclick: () => {
            const set = new Set(draft.attachmentConfig.allowedTypes);
            if (set.has(id)) set.delete(id);
            else set.add(id);
            draft.attachmentConfig.allowedTypes = ATTACH_TYPES.map(([type]) => type).filter((type) => set.has(type));
            changed();
            renderInPlace(`[aria-label="Allowed attachment types"]`);
          },
        });
      }));
      attachSection = h("div", { class: "logger-attach" },
        h("span", { class: "logger-label", text: "Attachments" }),
        attachToggle,
        typePills);
    }

    const goalKind = goalKindOf(draft.mode, draft.inputType);
    draft.goalConfig = cleanGoalConfig(draft.goalConfig, goalKind);

    const goalEnable = h("div", { class: "logger-modes logger-goal-toggle", role: "radiogroup", "aria-label": "Goal" },
      h("div", { class: "logger-mode-row" }, GOAL_ENABLE.map(([id, text]) => h("button", {
        type: "button", class: "logger-mode", role: "radio",
        "aria-checked": String(Boolean(draft.goalConfig.enabled) === (id === "on")),
        "data-goal-enable": id, text,
        onclick: () => {
          const on = id === "on";
          if (draft.goalConfig.enabled === on) return;
          draft.goalConfig.enabled = on;
          if (on && goalKind === "compound") {
            if (!draft.goalConfig.fieldA.enabled && !draft.goalConfig.fieldB.enabled) {
              draft.goalConfig.fieldA.enabled = true;
            }
          }
          changed();
          renderInPlace(`[data-goal-enable="${id}"]`);
        },
      }))));

    const numberTarget = (slot, name) => {
      const input = h("input", {
        type: "number", class: "logger-input", name, step: "any", inputmode: "decimal",
        oninput: (event) => {
          const n = Number(event.target.value);
          if (Number.isFinite(n)) slot.targetValue = n;
          changed();
        },
      });
      input.value = String(slot.targetValue ?? 0);
      return input;
    };
    const opSelect = (slot, name, disabled = false) => {
      const box = selectBox(name, GOAL_OPS, slot.operator, (event) => {
        slot.operator = GOAL_OP_SET.has(event.target.value) ? event.target.value : ">=";
        changed();
      });
      if (disabled) box.disabled = true;
      return box;
    };

    let goalBody = null;
    if (draft.goalConfig.enabled) {
      if (goalKind === "boolean") {
        const truth = selectBox("goal-bool", [
          ["true", draft.booleanConfig.trueLabel || "Yes"],
          ["false", draft.booleanConfig.falseLabel || "No"],
        ], draft.goalConfig.targetValue ? "true" : "false", (event) => {
          draft.goalConfig.targetValue = event.target.value !== "false";
          changed();
        });
        goalBody = h("div", { class: "logger-pair logger-goal-fields" },
          field("Operator", opSelect(draft.goalConfig, "goal-op", true)),
          field("Target", truth));
      } else if (goalKind === "compound") {
        const compoundRow = (key, label) => {
          const slot = draft.goalConfig[key];
          const toggle = h("div", { class: "logger-modes logger-goal-toggle is-mini", role: "radiogroup", "aria-label": `${label} goal` },
            h("div", { class: "logger-mode-row" }, GOAL_ENABLE.map(([id, text]) => h("button", {
              type: "button", class: "logger-mode", role: "radio",
              "aria-checked": String(Boolean(slot.enabled) === (id === "on")),
              "data-goal-field": key, "data-goal-enable": id, text,
              onclick: () => {
                const on = id === "on";
                if (slot.enabled === on) return;
                slot.enabled = on;
                changed();
                renderInPlace(`[data-goal-field="${key}"][data-goal-enable="${id}"]`);
              },
            }))));
          return h("div", { class: "logger-goal-compound" },
            h("div", { class: "logger-goal-compound-head" },
              h("span", { class: "logger-label", text: label }),
              toggle),
            slot.enabled && h("div", { class: "logger-pair logger-goal-fields" },
              field("Operator", opSelect(slot, `goal-${key}-op`)),
              field("Target", numberTarget(slot, `goal-${key}-value`))));
        };
        const aLabel = clip(draft.compoundConfig.fieldALabel, LABEL_MAX) || "Field A";
        const bLabel = clip(draft.compoundConfig.fieldBLabel, LABEL_MAX) || "Field B";
        goalBody = h("div", { class: "logger-type-settings" },
          compoundRow("fieldA", aLabel),
          compoundRow("fieldB", bLabel));
      } else {
        goalBody = h("div", { class: "logger-pair logger-goal-fields" },
          field("Operator", opSelect(draft.goalConfig, "goal-op")),
          field("Target", numberTarget(draft.goalConfig, "goal-value")));
      }
    }

    const goalSection = h("div", { class: "logger-goal" },
      h("span", { class: "logger-label", text: "Goal (optional)" }),
      goalEnable,
      goalBody);

    let foot;
    if (editing && ui.confirmDelete) {
      const names = users.map((user) => `"${user.name}"`);
      foot = h("div", { class: "logger-editor-foot is-confirming" },
        h("span", { class: "logger-confirm-text", text: users.length ? `Delete "${editing.name}"? It's taken out of ${listOf(names)}.` : `Delete "${editing.name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", "data-logger-cancel-delete": "", onclick: () => { ui.confirmDelete = false; render(() => el.editor.querySelector("[data-logger-delete]")?.focus()); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteLogger(editing.id) }));
    } else if (editing) {
      foot = h("div", { class: "logger-editor-foot" },
        h("button", {
          type: "button", class: "logger-text-btn is-danger", text: "Delete", "data-logger-delete": "",
          onclick: () => { ui.confirmDelete = true; render(() => el.editor.querySelector("[data-logger-cancel-delete]")?.focus()); },
        }),
        statusLine(),
        h("button", { type: "button", class: "logger-text-btn", text: "Done", onclick: deselect }));
    } else {
      foot = h("div", { class: "logger-editor-foot" },
        h("button", { type: "button", class: "logger-text-btn", text: "Cancel", onclick: deselect }),
        statusLine(),
        h("button", { type: "submit", class: "logger-primary", text: "Create Logger" }));
    }

    const head = h("div", { class: "logger-editor-head" },
      heading,
      h("button", { type: "button", class: "logger-icon-btn", title: "Close", "aria-label": "Close", onclick: deselect }, icon("close")));

    el.editor.replaceChildren(
      head,
      h("div", { class: "logger-editor-body" },
        h("div", { class: "logger-pair logger-name-look" },
          field("Name", name),
          h("div", { class: "logger-field" }, h("span", { class: "logger-label", id: "logger-icon-hint", text: "Icon & Colour" }), look)),
        field("Group", group),
        users.length > 0 && h("div", { class: "logger-field" }, h("span", { class: "logger-label", text: "Used By" }),
          h("div", { class: "logger-used-by" }, users.map((user) => h("button", {
            type: "button", class: "logger-chip", "aria-label": `Open ${user.name}`, onclick: () => select(user.id),
          }, tile(user), h("span", { class: "logger-row-name", text: user.name }))))),
        h("div", { class: "logger-field logger-mode-field" }, h("span", { class: "logger-label", text: "Mode" }), modes, kindNote),
        h("div", { class: "logger-mode-panel" }, modePanel),
        attachSection,
        goalSection),
      foot);
  }

  /* The pop-over's logger as it would be saved ({ logger, existing }), or { error, selector } saying what stops it.
     Leniently (for the tree) nothing stops it: a blank name stands in with what's saved, or a placeholder. */
  function buildFromDraft(loggers, lenient = false) {
    const draft = ui.draft;
    const existing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const id = existing?.id || (lenient ? NEW_ID : newId("lgr"));
    const others = loggers.filter((logger) => logger.id !== id);
    let name = clip(draft.name, NAME_MAX);
    if (!name) {
      if (!lenient) return { error: "Give the logger a name.", selector: "[name='name']" };
      name = existing?.name || "New logger";
    }
    const raw = { ...(existing || {}), id, name, icon: normalizeIcon(draft.icon), color: draft.color, groupId: draft.groupId, mode: draft.mode };
    if (!existing && ui.ghostPos) {
      raw.x = ui.ghostPos.x;
      raw.y = ui.ghostPos.y;
    }
    for (const key of STANDARD_CONFIG_KEYS) delete raw[key];
    delete raw.unit;
    delete raw.inputType;
    delete raw.rollupConfig;
    delete raw.goalConfig;
    delete raw.attachmentConfig;
    if (draft.mode === "standard") {
      Object.assign(raw, { inputType: draft.inputType });
      if (UNIT_TYPES.has(draft.inputType)) raw.unit = draft.unit;
      applyStandardConfig(raw, draft.inputType, draft);
      raw.attachmentConfig = cleanAttachmentConfig(draft.attachmentConfig);
    }
    raw.goalConfig = cleanGoalConfig(draft.goalConfig, goalKindOf(draft.mode, draft.inputType));
    // A metric saves before its sources are connected (pending), showing — until they are.
    if (draft.mode === "rollup") {
      const pruned = pruneTargetsForMath(draft.math, draft.targets, loggers, id);
      if (draft.math === "ratio") {
        raw.rollupConfig = { math: "ratio", targetLoggers: pruned };
      } else {
        raw.rollupConfig = {
          math: draft.math,
          targetLoggers: pruned.filter((target) => target && others.some((logger) => logger.id === target)),
        };
      }
    }
    const now = new Date().toISOString();
    const logger = cleanLogger({ ...raw, createdAt: existing?.createdAt || now, updatedAt: lenient ? existing?.updatedAt || now : now });
    if (!lenient && sourcesOf(logger).some((source) => source === id || readsFrom(loggers, source, id))) {
      return { error: "That would make this logger depend on itself." };
    }
    return { logger, existing };
  }

  // After each change in the pop-over: a saved logger saves, and the groups and tree follow it (into another group, if
  // it moved).
  function changed() {
    const draft = ui.draft;
    if (!draft) return;
    ui.groupKey = draft.groupId;
    if (ui.selectedId) {
      const { loggers, groups } = readAll();
      const built = buildFromDraft(loggers);
      if (built.error) setStatus(built.error, true);
      else if (!autosave(loggers.map((row) => (row.id === built.logger.id ? built.logger : row)), groups, waitingNote(built.logger))) {
        setStatus("Sign in to keep loggers.", true);
      }
    } else if (ui.status.error) {
      setStatus("");
    }
    refresh();
  }

  // What a pending metric still waits for, said after a save.
  function waitingNote(logger) {
    const pending = pendingOf(logger);
    if (!pending.length) return "";
    return pending[0] === "sources" ? "It shows \u2014 until it has sources."
      : `It shows \u2014 until ${listOf(pending)} ${pending.length === 1 ? "has a logger" : "have loggers"}.`;
  }

  function createFromDraft() {
    const { loggers, groups } = readAll();
    const built = buildFromDraft(loggers);
    if (built.error) return fail(built.error, built.selector);
    if (!persist([...loggers, built.logger], groups, "Created.", waitingNote(built.logger))) return fail("Sign in to keep loggers.", null);
    Object.assign(ui, {
      selectedId: built.logger.id, draft: draftOf(built.logger), groupKey: built.logger.groupId, confirmDelete: false, ghostPos: null,
    });
    renderInPlace();
    focusNode(built.logger.id, false);
  }

  // Enter in a saved logger's form sends what's waiting to Google Drive now.
  function saveNow() {
    const { loggers } = readAll();
    const built = buildFromDraft(loggers);
    if (built.error) return fail(built.error, built.selector);
    report("", waitingNote(built.logger));
  }

  /* ---------- Making a source from inside a roll-up ---------- */

  // A few fields for a new input logger, inside the open roll-up's sources or under a ratio's A/B. Its fields live
  // in ui.quick, so a redraw keeps what's typed.
  function quickForm(groups) {
    const quick = ui.quick;
    const purpose = quick.letter ? `for ${quick.letter}` : "as a source";
    const math = ui.draft?.math || "sum";
    const typeChoices = INPUT_TYPES.filter(([id]) => isEligibleSource({ mode: "standard", inputType: id }, math));
    if (!typeChoices.some(([id]) => id === quick.inputType) && typeChoices[0]) quick.inputType = typeChoices[0][0];
    let box;
    const name = h("input", {
      type: "text", class: "logger-input", name: "quick-name", maxlength: NAME_MAX, placeholder: "e.g. Steps", autocomplete: "off",
      oninput: (event) => {
        quick.name = event.target.value;
        if (!quick.error) return;
        quick.error = "";
        box.querySelector(".logger-quick-error")?.remove();
      },
    });
    name.value = quick.name;
    const unit = h("input", {
      type: "text", class: "logger-input", name: "quick-unit", maxlength: UNIT_MAX, autocomplete: "off", placeholder: unitPlaceholder(quick.inputType),
      oninput: (event) => { quick.unit = event.target.value; },
    });
    unit.value = quick.unit;
    const unitField = field("Unit Label", unit);
    unitField.hidden = !UNIT_TYPES.has(quick.inputType);
    const type = selectBox("quick-type", typeChoices.length ? typeChoices : INPUT_TYPES, quick.inputType, (event) => {
      quick.inputType = event.target.value;
      unitField.hidden = !UNIT_TYPES.has(quick.inputType);
      unit.placeholder = unitPlaceholder(quick.inputType);
    });
    const group = selectBox("quick-group", [["", "No group"], ...groups.map((row) => [row.id, row.name])], quick.groupId, (event) => { quick.groupId = event.target.value; });
    box = h("div", {
      class: "logger-quick", role: "group", "aria-label": `New input logger ${purpose}`, "data-quick": "",
      onkeydown: (event) => {
        // Enter in its fields adds the logger rather than submitting the roll-up around it.
        if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
        event.preventDefault();
        event.stopPropagation();
        addQuickSource();
      },
    },
    h("p", { class: "logger-quick-title", text: `New input logger ${purpose}` }),
    field("Name", name),
    h("div", { class: "logger-quick-row" }, field("Input Type", type), unitField),
    field("Group", group),
    quick.error && h("p", { class: "logger-quick-error", role: "alert", text: quick.error }),
    h("div", { class: "logger-quick-actions" },
      h("button", { type: "button", class: "logger-small-btn", text: "Cancel", onclick: () => closeQuick() }),
      h("button", { type: "button", class: "logger-small-btn is-primary", text: quick.letter ? `Add as ${quick.letter}` : "Add & Tick", onclick: () => addQuickSource() })));
    return box;
  }

  // `letter` is "A"/"B" for a ratio slot, or "" for a multi-source roll-up. It starts in the open logger's group.
  function openQuick(letter) {
    const math = ui.draft?.math || "sum";
    const inputType = math === "count" ? "boolean" : "numeric";
    ui.quick = { mode: ui.draft.mode, letter, name: "", inputType, unit: "", groupId: ui.draft.groupId, error: "" };
    renderInPlace("[name='quick-name']");
  }

  function closeQuick() {
    const letter = ui.quick?.letter;
    ui.quick = null;
    renderInPlace(`[data-quick-open="${letter || "rollup"}"]`);
  }

  /* Saves the new input logger at once and ticks it as a source (or sets it as A/B), so it hangs off the open node
     in the tree. A saved roll-up keeps that straight away; a new one once it's created. */
  function addQuickSource() {
    const quick = ui.quick;
    if (!quick) return;
    const name = clip(quick.name, NAME_MAX);
    if (!name) {
      quick.error = "Give the new logger a name.";
      renderInPlace("[name='quick-name']");
      return;
    }
    const { loggers, groups } = readAll();
    const now = new Date().toISOString();
    const logger = cleanLogger({
      id: newId("lgr"), name, icon: "", color: DEFAULT_COLOR, groupId: groups.some((row) => row.id === quick.groupId) ? quick.groupId : "",
      mode: "standard", inputType: quick.inputType, unit: quick.unit, createdAt: now, updatedAt: now,
    });
    if (quick.letter === "A" || quick.letter === "B") {
      const index = quick.letter === "A" ? 0 : 1;
      const next = [...(ui.draft.targets.length >= 2 ? ui.draft.targets : [ui.draft.targets[0] || "", ui.draft.targets[1] || ""])];
      next[index] = logger.id;
      ui.draft.math = "ratio";
      ui.draft.targets = next;
    } else {
      ui.draft.targets = [...ui.draft.targets.filter(Boolean), logger.id];
    }
    const parent = clip(ui.draft.name, NAME_MAX) || "the new logger";
    const placed = quick.letter ? `It's ${quick.letter} in ${parent}` : `It's a source of ${parent}`;
    let next = [...loggers, logger];
    let after = `${placed}; Create Logger keeps that.`;
    if (ui.selectedId) {
      const built = buildFromDraft(next);
      if (built.error) after = `${placed} once the form is fixed.`;
      else {
        next = next.map((row) => (row.id === built.logger.id ? built.logger : row));
        after = `${placed}.`;
      }
    }
    if (!persist(next, groups, `Created "${name}".`, after)) {
      fail("Sign in to keep loggers.", null);
      return;
    }
    ui.quick = null;
    renderInPlace(quick.letter ? `[name="ratio-${quick.letter}"]` : `.logger-check input[value="${CSS.escape(logger.id)}"]`);
    focusNode(logger.id, false);
  }

  /* ---------- Saving ---------- */

  // The line in the drawer's foot; it outlasts redraws until something else is said (or the drawer turns to another
  // logger).
  function setStatus(text, error = false) {
    ui.status = { text: text || "", error: Boolean(error) };
    const status = el?.editor.querySelector("[data-logger-status]");
    if (!status) return;
    status.textContent = ui.status.text;
    status.classList.toggle("is-error", ui.status.error);
  }

  const sentence = (...parts) => parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ");

  // Sends the saved lists to Google Drive now: `done` is said at once, then whether Drive has them, then `after`.
  function report(done, after = "") {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    const seq = ++ui.saveSeq;
    setStatus(sentence(done || "Saving\u2026", after));
    Promise.resolve(store()?.flush?.())
      .then(() => { if (seq === ui.saveSeq) setStatus(sentence(done, "Saved to Google Drive.", after)); })
      .catch(() => { if (seq === ui.saveSeq) setStatus(sentence(done, "Kept on this device until Google Drive can be reached.", after)); });
  }

  // Saves the lists (into ficus_master_backup.json), sending them to Google Drive straight away.
  function persist(loggers, groups, done, after = "") {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    report(done, after);
    return true;
  }

  // A change made as it's typed: kept at once, sent to Google Drive once the changes pause.
  function autosave(loggers, groups, after = "") {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    ui.saveSeq += 1;
    clearTimeout(ui.saveTimer);
    setStatus(sentence("Saving\u2026", after));
    ui.saveTimer = setTimeout(() => report("", after), SAVE_PAUSE);
    return true;
  }

  // Sends a change still waiting for a pause to Google Drive now, without a word (the pop-over is moving on).
  function settle() {
    if (!ui.saveTimer) return;
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    ui.saveSeq += 1;
    Promise.resolve(store()?.flush?.()).catch(() => {});
  }

  // "A", "A and B", "A, B and C".
  const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  function fail(text, selector) {
    setStatus(text, true);
    if (selector) el.editor.querySelector(selector)?.focus();
  }

  // Deletes a logger, taking it out of the roll-ups that read from it (their lines to it go too).
  function deleteLogger(id) {
    const { loggers, groups } = readAll();
    const now = new Date().toISOString();
    const next = loggers.filter((logger) => logger.id !== id).map((logger) => {
      if (logger.mode !== "rollup" || !logger.rollupConfig.targetLoggers.includes(id)) return logger;
      if (logger.rollupConfig.math === "ratio") {
        logger.rollupConfig.targetLoggers = logger.rollupConfig.targetLoggers.map((target) => (target === id ? "" : target));
      } else {
        logger.rollupConfig.targetLoggers = logger.rollupConfig.targetLoggers.filter((target) => target !== id);
      }
      return { ...logger, updatedAt: now };
    });
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false, quick: null });
    persist(next, groups, "Deleted.");
    render(() => el.addNode.focus({ preventScroll: true }));
  }

  function onKey(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (ui.groupConfirm) {
        const id = ui.groupConfirm;
        ui.groupConfirm = null;
        render(() => focusGroup(id, "delete"));
      } else if (ui.quick) {
        closeQuick();
      } else if (ui.lookPop) {
        closeLookPops();
      } else if (ui.confirmDelete) {
        ui.confirmDelete = false;
        render(() => el.editor.querySelector("[data-logger-delete]")?.focus());
      } else if (ui.draft) {
        deselect();
      } else {
        close();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...el.overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
      .filter((node) => node.getClientRects().length && !node.closest("[hidden]"));
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement);
    if (event.shiftKey ? at <= 0 : at === controls.length - 1) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
    }
  }

  window.FicusLoggers = {
    open,
    close,
    read: readAll,
    cleanLogger,
    cleanGroup,
    rollUp,
    readsFrom,
    kindOf,
    pendingOf,
    calculate,
    formatValue,
    unitOfId,
    layoutTree,
    edgePath,
    validateLoggedValue,
    isEligibleSource,
    refreshValues,
    latestValues,
    MODES: MODES.map(([id]) => id),
    KINDS: KINDS.map(([id]) => id),
    INPUT_TYPES: INPUT_TYPES.map(([id]) => id),
    ROLLUP_MATH: ROLLUP_MATH.map(([id]) => id),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
