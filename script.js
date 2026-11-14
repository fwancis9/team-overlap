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
  /* Lucide icons (lucide.dev, ISC license): sun, sunset. Lucide has no "zzz", so sleep is a matching hand-drawn Zzz. */
  const STATE_ICON_PATHS = {
    work: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    awake: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    sleep: '<path d="M3 13h7l-7 8h7"/><path d="M13 7h5l-5 6h5"/><path d="M19 2h3l-3 4h3"/>'
  };
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const planner = { start: null, lengthMinutes: 60, direction: "up" };
  /* Last text shown in each rolling slot, so only changed characters animate. */
  const previousTexts = { now: [], range: [] };

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

  /* Earliest slot with the highest score in the 24 hours from windowStart, never before the next slot from now. */
  function findBestInDay(windowStart) {
    const first = Math.max(Math.ceil(windowStart / SLOT_MS) * SLOT_MS, nextSlotStart());
    const windowEnd = windowStart + 24 * 60 * MINUTE_MS;
    let best = null;
    let bestScore = -1;
    for (let candidate = first; candidate < windowEnd; candidate += SLOT_MS) {
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

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function ghostCharacter(character, direction) {
    const ghost = createElement("span", "roll-old roll-out-" + direction, character);
    ghost.setAttribute("aria-hidden", "true");
    ghost.addEventListener("animationend", function () { ghost.remove(); });
    return ghost;
  }

  /* Writes text one character per span. Changed characters slide in while the old one slides out. */
  function renderRolling(element, previousText, nextText, direction) {
    const shouldAnimate = Boolean(previousText) && previousText !== nextText && !prefersReducedMotion();
    const sameLength = shouldAnimate && previousText.length === nextText.length;
    element.replaceChildren();
    element.setAttribute("aria-label", nextText);
    Array.from(nextText).forEach(function (character, index) {
      const holder = createElement("span", character === "–" ? "roll-char range-dash" : "roll-char");
      holder.setAttribute("aria-hidden", "true");
      const current = createElement("span", "roll-new", character);
      holder.appendChild(current);
      const oldCharacter = shouldAnimate ? previousText[index] : undefined;
      if (shouldAnimate && (!sameLength || oldCharacter !== character)) {
        holder.classList.add("roll-window");
        current.classList.add("roll-in-" + direction);
        current.addEventListener("animationend", function () { holder.classList.remove("roll-window"); });
        if (oldCharacter && oldCharacter.trim()) holder.appendChild(ghostCharacter(oldCharacter, direction));
      }
      element.appendChild(holder);
    });
  }

  function stateIcon(state) {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    icon.setAttribute("class", "state-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = STATE_ICON_PATHS[state];
    return icon;
  }

  /* Status text with its icon on the right, e.g. "Asleep ☾". Skips work when nothing changed. */
  function setStateLabel(element, state, baseClass) {
    if (element.dataset.state === state) return;
    element.dataset.state = state;
    element.className = baseClass + " state-" + state;
    element.replaceChildren(document.createTextNode(STATE_TEXT[state]), stateIcon(state));
  }

  /* ---------- Right now ---------- */

  function createNowCard(person) {
    const card = createElement("div", "now-person");
    const timeText = createElement("div", "now-time");
    const dayText = createElement("div", "now-day");
    const stateText = createElement("div", "now-state");
    card.append(createElement("div", "now-name", person.name), timeText, dayText, stateText);
    card.parts = { timeText: timeText, dayText: dayText, stateText: stateText };
    return card;
  }

  function nowCards() {
    const grid = document.getElementById("now-grid");
    if (grid.children.length !== PEOPLE.length) {
      grid.replaceChildren.apply(grid, PEOPLE.map(createNowCard));
    }
    return Array.from(grid.children);
  }

  /* Updates each clock in place; only digits that changed roll up. */
  function renderNow() {
    const now = Date.now();
    nowCards().forEach(function (card, index) {
      const person = PEOPLE[index];
      const state = personState(now, person.zone);
      const timeText = formatTime(now, person.zone);
      if (previousTexts.now[index] !== timeText) {
        renderRolling(card.parts.timeText, previousTexts.now[index], timeText, "up");
        previousTexts.now[index] = timeText;
      }
      card.parts.dayText.textContent = formatDateLong(now, person.zone);
      setStateLabel(card.parts.stateText, state, "now-state");
    });
  }

  /* Ticks right as each minute turns over, so the roll lands on time. */
  function scheduleNextMinute() {
    const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + 50;
    setTimeout(function () {
      renderNow();
      scheduleNextMinute();
    }, delay);
  }

  /* ---------- Planner ---------- */

  function syncLengthLabel() {
    const choice = LENGTH_CHOICES.find(function (item) { return item.minutes === planner.lengthMinutes; });
    document.getElementById("length-label").textContent = choice ? choice.label : "";
  }

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

  /* Grows or shrinks the box to its new height instead of snapping. */
  function animateVerdictChange(verdict, startHeight) {
    if (prefersReducedMotion() || typeof verdict.animate !== "function") return;
    const timing = { duration: 350, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    const endHeight = verdict.getBoundingClientRect().height;
    if (Math.abs(endHeight - startHeight) > 0.5) {
      verdict.animate([{ height: startHeight + "px" }, { height: endHeight + "px" }], timing);
    }
  }

  function renderVerdict(status, states, overrideText) {
    const verdict = document.getElementById("plan-verdict");
    const text = overrideText || verdictText(status, states || []);
    const className = "plan-verdict row-" + status;
    if (verdict.dataset.text === text && verdict.className === className) return;
    const isFirstRender = !verdict.dataset.text;
    const startHeight = verdict.getBoundingClientRect().height;
    verdict.className = className;
    verdict.dataset.text = text;
    const textElement = createElement("span", "verdict-text", text);
    verdict.replaceChildren(textElement);
    if (!isFirstRender) animateVerdictChange(verdict, startHeight);
  }

  /* Builds a row once; later renders only update its text so the page never re-lays out. */
  function createPersonRow(person) {
    const item = createElement("li", "plan-person");
    const rangeText = createElement("span", "plan-range-text");
    const dateText = createElement("small");
    const stateText = createElement("span", "plan-state");
    const range = createElement("span", "plan-range");
    range.append(rangeText, dateText);
    item.append(createElement("span", "plan-name", person.name), range, stateText);
    item.parts = { rangeText: rangeText, dateText: dateText, stateText: stateText };
    return item;
  }

  function updatePersonRow(item, person, state, index) {
    const end = planner.start + planner.lengthMinutes * MINUTE_MS;
    const rangeText = formatRange(planner.start, end, person.zone);
    if (previousTexts.range[index] !== rangeText) {
      renderRolling(item.parts.rangeText, previousTexts.range[index], rangeText, planner.direction);
      previousTexts.range[index] = rangeText;
    }
    item.parts.dateText.textContent = formatDateLong(planner.start, person.zone);
    setStateLabel(item.parts.stateText, state, "plan-state");
  }

  function personRows() {
    const list = document.getElementById("plan-list");
    if (list.children.length !== PEOPLE.length) {
      list.replaceChildren.apply(list, PEOPLE.map(createPersonRow));
    }
    return Array.from(list.children);
  }

  function renderPlanResult() {
    const list = document.getElementById("plan-list");
    if (planner.start === null) {
      list.hidden = true;
      renderVerdict("bad");
      return;
    }
    list.hidden = false;
    const states = statesFor(planner.start);
    renderVerdict(overallStatus(states), states);
    personRows().forEach(function (item, index) { updatePersonRow(item, PEOPLE[index], states[index], index); });
  }

  function renderPlanner() {
    syncDateInput();
    syncLengthLabel();
    renderStepButtons();
    renderPlanResult();
  }

  function moveTo(nextStart) {
    planner.direction = nextStart >= planner.start ? "up" : "down";
    planner.start = nextStart;
  }

  /* The arrow slides out through its clipped window while a fresh one slides in behind it, like the rolling digits but sideways. */
  function slideArrow(direction) {
    const windowElement = document.querySelector((direction < 0 ? "#earlier-button" : "#later-button") + " .step-arrow");
    if (!windowElement || prefersReducedMotion()) return;
    const side = direction < 0 ? "left" : "right";
    const current = windowElement.querySelector(".arrow-glyph:not(.arrow-out)");
    if (!current) return;
    const incoming = current.cloneNode(true);
    incoming.className = "arrow-glyph arrow-in-" + side;
    current.className = "arrow-glyph arrow-out arrow-out-" + side;
    current.addEventListener("animationend", function () { current.remove(); });
    windowElement.appendChild(incoming);
  }

  function step(direction) {
    slideArrow(direction);
    const next = findWorkable(planner.start, direction, false);
    if (next === null) return;
    moveTo(next);
    renderPlanner();
  }

  function findSoonestBest() {
    return findBestInDay(nextSlotStart());
  }

  /* "YYYY-MM-DD" in the viewer's own device time zone. */
  function deviceDateString(timestamp) {
    const date = new Date(timestamp);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function deviceMidnight(dateString) {
    const pieces = dateString.split("-").map(Number);
    return new Date(pieces[0], pieces[1] - 1, pieces[2]).getTime();
  }

  /* "Sat Nov 14" in the viewer's own time zone. */
  function formatPillDate(timestamp) {
    return new Date(timestamp).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(/,/g, "");
  }

  function syncDateInput() {
    const input = document.getElementById("date-input");
    const firstWorkable = findWorkable(nextSlotStart(), 1, true);
    input.min = deviceDateString(firstWorkable === null ? Date.now() : firstWorkable);
    if (planner.start === null) return;
    input.value = deviceDateString(planner.start);
    document.getElementById("date-label").textContent = formatPillDate(planner.start);
  }

  function openDatePicker(event) {
    try {
      if (typeof event.target.showPicker === "function") {
        event.target.showPicker();
        event.preventDefault();
      }
    } catch (error) {
      /* Browser opens its own picker from the click instead. */
    }
  }

  function jumpToDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return;
    const midnight = deviceMidnight(dateString);
    const best = findBestInDay(midnight);
    if (best !== null) {
      moveTo(best);
      renderPlanner();
      return;
    }
    const fallback = findWorkable(Math.max(Math.ceil(midnight / SLOT_MS) * SLOT_MS, nextSlotStart()), 1, true);
    if (fallback === null) {
      syncDateInput();
      renderVerdict("bad", [], "No time works for everyone on that date.");
      return;
    }
    moveTo(fallback);
    renderPlanner();
    explainFallback(midnight);
  }

  /* Adds a note to the result line saying the picked date had nothing left. */
  function explainFallback(pickedMidnight) {
    const states = statesFor(planner.start);
    const status = overallStatus(states);
    const note = "Nothing works on " + formatPillDate(pickedMidnight) + ", so this is the next time that does. ";
    renderVerdict(status, states, note + verdictText(status, states));
  }

  function jumpToEarliest() {
    const earliest = findWorkable(nextSlotStart(), 1, true);
    if (earliest === null) return;
    moveTo(earliest);
    renderPlanner();
  }

  function jumpToSoonestBest() {
    const best = findSoonestBest();
    if (best === null) return;
    moveTo(best);
    renderPlanner();
  }

  function changeLength(minutes) {
    planner.direction = minutes >= planner.lengthMinutes ? "up" : "down";
    planner.lengthMinutes = minutes;
    if (planner.start === null || !isWorkable(planner.start)) {
      planner.start = findWorkable(planner.start === null ? nextSlotStart() : planner.start, 1, true);
    }
    renderPlanner();
  }

  /* ---------- Start ---------- */

  /* Remembers whether a pill was opened by tap/click (no outline) or keyboard (outline). */
  function trackPointerFocus(control) {
    const pill = control.closest(".overlay-pill");
    if (!pill) return;
    control.addEventListener("pointerdown", function () { pill.classList.add("is-pointer"); });
    control.addEventListener("keydown", function () { pill.classList.remove("is-pointer"); });
    control.addEventListener("blur", function () { pill.classList.remove("is-pointer"); });
  }

  function bindEvents() {
    document.querySelectorAll(".overlay-control").forEach(trackPointerFocus);
    document.getElementById("earliest-button").addEventListener("click", jumpToEarliest);
    document.getElementById("soonest-button").addEventListener("click", jumpToSoonestBest);
    document.getElementById("earlier-button").addEventListener("click", function () { step(-1); });
    document.getElementById("later-button").addEventListener("click", function () { step(1); });
    document.getElementById("date-input").addEventListener("click", openDatePicker);
    document.getElementById("date-input").addEventListener("change", function (event) {
      jumpToDate(event.target.value);
    });
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
      scheduleNextMinute();
    } catch (error) {
      document.getElementById("now-grid").textContent = "Times could not load in this browser.";
    }
  }

  startPage();
})();
