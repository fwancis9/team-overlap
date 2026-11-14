(function () {
  "use strict";

  const MINUTE_MS = 60000;
  const SAMPLE_MINUTES = 30;
  const SLOT_MS = SAMPLE_MINUTES * MINUTE_MS;
  const SEARCH_LIMIT_SLOTS = 14 * 48;
  const WORK_HOURS = { start: 9, end: 18 };
  const AWAKE_HOURS = { start: 7, end: 23 };
  const LENGTH_CHOICES = [
    { minutes: 30, label: "30 min meeting" },
    { minutes: 60, label: "1 hr meeting" },
    { minutes: 90, label: "1½ hr meeting" },
    { minutes: 120, label: "2 hr meeting" }
  ];
  const PEOPLE = [
    { name: "Gage", zone: "America/Denver" },
    { name: "Cora", zone: "America/Los_Angeles" },
    { name: "Wills", zone: "Asia/Manila" },
    { name: "Marc", zone: "Asia/Manila" }
  ];
  const PLAN_VERDICT_TEXT = {
    good: "Good time for everyone.",
    bad: "No time works for everyone in the next two weeks."
  };
  const STATE_TEXT = { work: "Good time", awake: "After hours", sleep: "Asleep" };
  const planner = { start: null, lengthMinutes: 60 };

  /* ---------- Time helpers ---------- */

  const hourFormatters = new Map();
  function localHour(timestamp, zone) {
    if (!hourFormatters.has(zone)) {
      hourFormatters.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }));
    }
    return Number(hourFormatters.get(zone).format(new Date(timestamp))) % 24;
  }

  function formatTime(timestamp, zone) {
    return new Date(timestamp).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  }

  function formatDateLong(timestamp, zone) {
    return new Date(timestamp).toLocaleDateString("en-US", { timeZone: zone, weekday: "long", month: "short", day: "numeric" });
  }

  function formatRange(start, end, zone) {
    return formatTime(start, zone) + " – " + formatTime(end, zone);
  }

  function nextSlotStart() {
    return Math.ceil(Date.now() / SLOT_MS) * SLOT_MS;
  }

  /* ---------- Availability ---------- */

  function personState(timestamp, zone) {
    const hour = localHour(timestamp, zone);
    if (hour >= WORK_HOURS.start && hour < WORK_HOURS.end) return "work";
    if (hour >= AWAKE_HOURS.start && hour < AWAKE_HOURS.end) return "awake";
    return "sleep";
  }

  function personStateOverRange(start, lengthMinutes, zone) {
    const rank = { work: 2, awake: 1, sleep: 0 };
    let worst = "work";
    for (let offset = 0; offset < lengthMinutes; offset += SAMPLE_MINUTES) {
      const current = personState(start + offset * MINUTE_MS, zone);
      if (rank[current] < rank[worst]) worst = current;
    }
    return worst;
  }

  function statesFor(start) {
    return PEOPLE.map(function (person) { return personStateOverRange(start, planner.lengthMinutes, person.zone); });
  }

  function overallStatus(states) {
    if (states.includes("sleep")) return "bad";
    return states.every(function (item) { return item === "work"; }) ? "good" : "okay";
  }

  function isWorkable(start) {
    return overallStatus(statesFor(start)) !== "bad";
  }

  /* Higher is better: how many people are inside work hours. -1 when someone is asleep. */
  function slotScore(start) {
    const states = statesFor(start);
    if (states.includes("sleep")) return -1;
    return states.filter(function (state) { return state === "work"; }).length;
  }

  /* Earliest slot in the next 24 hours with the highest score. */
  function findSoonestBest() {
    const first = nextSlotStart();
    let best = null;
    let bestScore = -1;
    for (let index = 0; index < 48; index += 1) {
      const candidate = first + index * SLOT_MS;
      const score = slotScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  /* Walks slot by slot from `from` in `direction` (+1 later, -1 earlier). Never goes before the next slot from now. */
  function findWorkable(from, direction, includeFrom) {
    const earliest = nextSlotStart();
    let candidate = includeFrom ? from : from + direction * SLOT_MS;
    for (let step = 0; step < SEARCH_LIMIT_SLOTS; step += 1) {
      if (candidate < earliest) return null;
      if (isWorkable(candidate)) return candidate;
      candidate += direction * SLOT_MS;
    }
    return null;
  }

  /* ---------- DOM helpers ---------- */

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- Right now ---------- */

  function renderNow() {
    const grid = document.getElementById("now-grid");
    const now = Date.now();
    grid.replaceChildren();
    PEOPLE.forEach(function (person) {
      const state = personState(now, person.zone);
      const card = createElement("div", "now-person");
      card.appendChild(createElement("div", "now-name", person.name));
      card.appendChild(createElement("div", "now-time", formatTime(now, person.zone)));
      card.appendChild(createElement("div", "now-day", formatDateLong(now, person.zone)));
      card.appendChild(createElement("div", "now-state state-" + state, STATE_TEXT[state]));
      grid.appendChild(card);
    });
  }

  /* ---------- Planner ---------- */

  function renderLengthSelect() {
    const select = document.getElementById("length-select");
    select.replaceChildren();
    LENGTH_CHOICES.forEach(function (choice) {
      const option = createElement("option", "", choice.label);
      option.value = String(choice.minutes);
      option.selected = choice.minutes === planner.lengthMinutes;
      select.appendChild(option);
    });
  }

  function renderStepButtons() {
    const hasStart = planner.start !== null;
    document.getElementById("earlier-button").disabled = !hasStart || findWorkable(planner.start, -1, false) === null;
    document.getElementById("later-button").disabled = !hasStart || findWorkable(planner.start, 1, false) === null;
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /* "early morning" if their off-hours part falls before work starts, otherwise "evening". */
  function offHoursKind(start, zone) {
    for (let offset = 0; offset < planner.lengthMinutes; offset += SAMPLE_MINUTES) {
      const timestamp = start + offset * MINUTE_MS;
      if (personState(timestamp, zone) === "awake") {
        return localHour(timestamp, zone) < WORK_HOURS.start ? "early morning" : "evening";
      }
    }
    return "evening";
  }

  /* Groups off-hours people by kind and local start time, e.g. "early morning for Wills and Marc (7:00 AM)". */
  function offHoursDetail(start, states) {
    const groups = [];
    PEOPLE.forEach(function (person, index) {
      if (states[index] !== "awake") return;
      const kind = offHoursKind(start, person.zone);
      const time = formatTime(start, person.zone);
      const existing = groups.find(function (group) { return group.kind === kind && group.time === time; });
      if (existing) existing.names.push(person.name);
      else groups.push({ kind: kind, time: time, names: [person.name] });
    });
    return groups.map(function (group) {
      return group.kind + " for " + joinNames(group.names) + " (" + group.time + ")";
    }).join(" and ");
  }

  function verdictText(status, states) {
    if (status !== "okay") return PLAN_VERDICT_TEXT[status];
    return "Okay, but it's " + offHoursDetail(planner.start, states) + ".";
  }

  function renderVerdict(status, states) {
    const verdict = document.getElementById("plan-verdict");
    verdict.className = "plan-verdict row-" + status;
    verdict.textContent = verdictText(status, states || []);
  }

  function renderPersonRow(person, state) {
    const end = planner.start + planner.lengthMinutes * MINUTE_MS;
    const item = createElement("li", "plan-person");
    item.appendChild(createElement("span", "plan-name", person.name));
    const range = createElement("span", "plan-range", formatRange(planner.start, end, person.zone));
    range.appendChild(createElement("small", "", formatDateLong(planner.start, person.zone)));
    item.appendChild(range);
    item.appendChild(createElement("span", "plan-state state-" + state, STATE_TEXT[state]));
    return item;
  }

  function renderPlanResult() {
    const list = document.getElementById("plan-list");
    list.replaceChildren();
    if (planner.start === null) {
      renderVerdict("bad");
      return;
    }
    const states = statesFor(planner.start);
    renderVerdict(overallStatus(states), states);
    PEOPLE.forEach(function (person, index) { list.appendChild(renderPersonRow(person, states[index])); });
  }

  function renderPlanner() {
    renderStepButtons();
    renderPlanResult();
  }

  function step(direction) {
    const next = findWorkable(planner.start, direction, false);
    if (next === null) return;
    planner.start = next;
    renderPlanner();
  }

  function jumpToSoonestBest() {
    const best = findSoonestBest();
    if (best === null) return;
    planner.start = best;
    renderPlanner();
  }

  function changeLength(minutes) {
    planner.lengthMinutes = minutes;
    if (planner.start === null || !isWorkable(planner.start)) {
      planner.start = findWorkable(planner.start === null ? nextSlotStart() : planner.start, 1, true);
    }
    renderPlanner();
  }

  /* ---------- Start ---------- */

  function bindEvents() {
    document.getElementById("soonest-button").addEventListener("click", jumpToSoonestBest);
    document.getElementById("earlier-button").addEventListener("click", function () { step(-1); });
    document.getElementById("later-button").addEventListener("click", function () { step(1); });
    document.getElementById("length-select").addEventListener("change", function (event) {
      changeLength(Number(event.target.value));
    });
  }

  function startPage() {
    try {
      renderNow();
      renderLengthSelect();
      planner.start = findWorkable(nextSlotStart(), 1, true);
      renderPlanner();
      bindEvents();
      setInterval(renderNow, 15000);
    } catch (error) {
      document.getElementById("now-grid").textContent = "Times could not load in this browser.";
    }
  }

  startPage();
})();
