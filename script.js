(function () {
  "use strict";

  const MINUTE_MS = 60000;
  const SAMPLE_MINUTES = 30;
  const SLOT_MS = SAMPLE_MINUTES * MINUTE_MS;
  const DAY_MS = 24 * 60 * MINUTE_MS;
  /* Preferred hours as minutes after local midnight. Anyone without their own uses the default. */
  const DEFAULT_HOURS = [{ start: 9 * 60, end: 23 * 60 }];
  const WEEKEND_DAYS = ["Sat", "Sun"];
  /* Browsers only give "GMT+8" for Manila, so name it the way people say it. */
  const ZONE_NAMES = { "Asia/Manila": "PHT" };
  const LENGTH_CHOICES = [
    { minutes: 30, label: "30 min meeting" },
    { minutes: 60, label: "1 hr meeting" },
    { minutes: 90, label: "1½ hr meeting" },
    { minutes: 120, label: "2 hr meeting" }
  ];
  const PEOPLE = [
    { name: "Gage", zone: "America/Denver" },
    { name: "Cora", zone: "Europe/London" },
    { name: "Wills", zone: "Asia/Manila" },
    {
      name: "Marc",
      zone: "Asia/Manila",
      hours: {
        weekday: [{ start: 20 * 60, end: 23 * 60 }],
        weekend: [{ start: 13 * 60, end: 23 * 60 }]
      }
    }
  ];
  const PLAN_VERDICT_TEXT = {
    good: "Good time for everyone.",
    bad: "No time works for everyone in the next two weeks."
  };
  const STATE_TEXT = { available: "Good time", unavailable: "Outside hours" };
  /* Lucide icons (lucide.dev, ISC license): sun, circle-minus. */
  const STATE_ICON_PATHS = {
    available: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    unavailable: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>'
  };
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const planner = { start: null, lengthMinutes: 60, direction: "up" };
  /* Last text shown in each rolling slot, so only changed characters animate. */
  const previousTexts = { now: [], range: [] };

  /* ---------- Time helpers ---------- */

  const clockFormatters = new Map();
  /* Local weekday ("Sat") and minutes after midnight for a moment in a time zone. */
  function localClock(timestamp, zone) {
    if (!clockFormatters.has(zone)) {
      clockFormatters.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }));
    }
    const parts = {};
    clockFormatters.get(zone).formatToParts(new Date(timestamp)).forEach(function (part) { parts[part.type] = part.value; });
    return { weekday: parts.weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
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

  function preferredHours(person, weekday) {
    if (!person.hours) return DEFAULT_HOURS;
    return WEEKEND_DAYS.includes(weekday) ? person.hours.weekend : person.hours.weekday;
  }

  /* 1200 -> "8 PM", 1230 -> "8:30 PM" */
  function formatMinutes(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return hour12 + (minute ? ":" + String(minute).padStart(2, "0") : "") + (hour < 12 ? " AM" : " PM");
  }

  /* e.g. "1 PM – 11 PM" or "3 PM – 7 PM, 8 PM – 10 PM" */
  function windowsText(windows) {
    return windows.map(function (window) {
      return formatMinutes(window.start) + " – " + formatMinutes(window.end);
    }).join(", ");
  }

  /* Short zone name at a moment, e.g. "MST", "GMT", "PHT". */
  function zoneName(timestamp, zone) {
    if (ZONE_NAMES[zone]) return ZONE_NAMES[zone];
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(new Date(timestamp))
        .find(function (item) { return item.type === "timeZoneName"; });
      return part ? part.value : "";
    } catch (error) {
      return "";
    }
  }

  /* Rows for the card: one "Every day" row, or separate Weekdays and Weekends rows. */
  function preferredHoursRows(person) {
    const weekdayText = windowsText(preferredHours(person, "Mon"));
    const weekendText = windowsText(preferredHours(person, "Sat"));
    if (weekdayText === weekendText) return [{ label: "Every day", hours: weekdayText }];
    return [
      { label: "Weekdays", hours: weekdayText },
      { label: "Weekends", hours: weekendText }
    ];
  }

  function personState(timestamp, person) {
    const clock = localClock(timestamp, person.zone);
    const isInside = preferredHours(person, clock.weekday).some(function (window) {
      return clock.minutes >= window.start && clock.minutes < window.end;
    });
    return isInside ? "available" : "unavailable";
  }

  /* Available only if every half hour of the meeting falls inside their preferred hours. */
  function personStateOverRange(start, lengthMinutes, person) {
    for (let offset = 0; offset < lengthMinutes; offset += SAMPLE_MINUTES) {
      if (personState(start + offset * MINUTE_MS, person) === "unavailable") return "unavailable";
    }
    return "available";
  }

  function statesFor(start) {
    return PEOPLE.map(function (person) { return personStateOverRange(start, planner.lengthMinutes, person); });
  }

  function overallStatus(states) {
    return states.every(function (item) { return item === "available"; }) ? "good" : "bad";
  }

  /* Higher is better: fewer total minutes of the meeting fall outside anyone's hours. */
  function minutesScore(start) {
    let outsideMinutes = 0;
    PEOPLE.forEach(function (person) {
      for (let offset = 0; offset < planner.lengthMinutes; offset += SAMPLE_MINUTES) {
        if (personState(start + offset * MINUTE_MS, person) === "unavailable") outsideMinutes += SAMPLE_MINUTES;
      }
    });
    return -outsideMinutes;
  }

  /* Earliest slot with the highest score between windowStart and windowEnd, never before the next slot from now. */
  function findBestBetween(windowStart, windowEnd, scoreOf) {
    const first = Math.max(Math.ceil(windowStart / SLOT_MS) * SLOT_MS, nextSlotStart());
    let best = null;
    let bestScore = -Infinity;
    for (let candidate = first; candidate < windowEnd; candidate += SLOT_MS) {
      const score = scoreOf(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function findBestInDay(dayStart) {
    return findBestBetween(dayStart, dayStart + DAY_MS, minutesScore);
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

  /* Status text with its icon on the right. Skips work when nothing changed. */
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
    const hoursText = createElement("div", "now-hours");
    card.append(createElement("div", "now-name", person.name), timeText, dayText, stateText, hoursText);
    card.parts = { timeText: timeText, dayText: dayText, stateText: stateText, hoursText: hoursText };
    return card;
  }

  function nowCards() {
    const grid = document.getElementById("now-grid");
    if (grid.children.length !== PEOPLE.length) {
      grid.replaceChildren.apply(grid, PEOPLE.map(createNowCard));
    }
    return Array.from(grid.children);
  }

  /* Heading names the zone once, so each row stays short enough for a narrow card. */
  function renderHoursRows(element, heading, rows) {
    const key = heading + JSON.stringify(rows);
    if (element.dataset.key === key) return;
    element.dataset.key = key;
    const lines = rows.map(function (row) {
      const line = createElement("div", "hours-row");
      line.append(createElement("span", "hours-label", row.label), createElement("span", "hours-value", row.hours));
      return line;
    });
    element.replaceChildren.apply(element, [createElement("div", "hours-heading", heading)].concat(lines));
  }

  /* Updates each clock in place; only digits that changed roll up. */
  function renderNow() {
    const now = Date.now();
    nowCards().forEach(function (card, index) {
      const person = PEOPLE[index];
      const state = personState(now, person);
      const timeText = formatTime(now, person.zone);
      if (previousTexts.now[index] !== timeText) {
        renderRolling(card.parts.timeText, previousTexts.now[index], timeText, "up");
        previousTexts.now[index] = timeText;
      }
      card.parts.dayText.textContent = formatDateLong(now, person.zone);
      setStateLabel(card.parts.stateText, state, "now-state");
      renderHoursRows(card.parts.hoursText, "Preferred hours, " + zoneName(now, person.zone), preferredHoursRows(person));
    });
  }

  /* Ticks right as each minute turns over, so the roll lands on time. */
  function scheduleNextMinute() {
    const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + 50;
    setTimeout(function () {
      renderNow();
      renderDayChart();
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
    document.getElementById("earlier-button").disabled = !hasStart || planner.start - SLOT_MS < nextSlotStart();
    document.getElementById("later-button").disabled = !hasStart;
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /* Groups people in `targetState` by kind and local start time, so "Wills and Marc (7:00 AM)" share one phrase. */
  function groupPeople(start, states, targetState, kindOf) {
    const groups = [];
    PEOPLE.forEach(function (person, index) {
      if (states[index] !== targetState) return;
      const kind = kindOf(person);
      const time = formatTime(start, person.zone);
      const existing = groups.find(function (group) { return group.kind === kind && group.time === time; });
      if (existing) existing.names.push(person.name);
      else groups.push({ kind: kind, time: time, names: [person.name] });
    });
    return groups;
  }

  /* e.g. "outside hours for Gage (2:00 AM) and Wills and Marc (5:30 PM)" */
  function unavailableDetail(start, states) {
    const people = groupPeople(start, states, "unavailable", function () { return "unavailable"; })
      .map(function (group) { return joinNames(group.names) + " (" + group.time + ")"; })
      .join(" and ");
    return "It's outside hours for " + people;
  }


  function verdictText(status, states) {
    if (status === "bad" && states.length) return "Not this time. " + unavailableDetail(planner.start, states) + ".";
    return PLAN_VERDICT_TEXT[status];
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

  /* Today's slots between device-local midnights, including daylight-saving changes. */
  function dayChartDateRange() {
    const dateString = deviceDateString(Date.now());
    const dayStart = deviceMidnight(dateString);
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEnd = deviceMidnight(deviceDateString(nextDay.getTime()));
    const slots = [];
    for (let slot = dayStart; slot < dayEnd; slot += SLOT_MS) slots.push(slot);
    return { dateString: dateString, dayStart: dayStart, slots: slots };
  }

  /* One "AM" and one "PM" band, each spanning its half of the day's columns. */
  function createDayChartBands(slots) {
    const firstPmIndex = slots.findIndex(function (slot) { return new Date(slot).getHours() >= 12; });
    const halves = [
      { label: "AM", start: 0, end: firstPmIndex === -1 ? slots.length : firstPmIndex },
      { label: "PM", start: firstPmIndex === -1 ? slots.length : firstPmIndex, end: slots.length }
    ];
    return halves.filter(function (half) { return half.end > half.start; }).map(function (half) {
      const band = createElement("div", "day-chart-band");
      band.style.gridColumn = (half.start + 2) + " / " + (half.end + 2);
      band.appendChild(createElement("span", "day-chart-band-label", half.label));
      return band;
    });
  }

  /* Hour number on the hour: 12, 1, 2 … 11. */
  function dayChartHourLabel(slot) {
    const date = new Date(slot);
    if (date.getMinutes() !== 0) return "";
    const hour = date.getHours() % 12;
    return String(hour === 0 ? 12 : hour);
  }

  function createDayChartColumn(slot, index, isPast) {
    const column = createElement("div", "day-chart-column");
    column.style.gridColumn = String(index + 2);
    if (isPast) column.classList.add("is-past");
    column.appendChild(createElement("span", "day-chart-hour-label", dayChartHourLabel(slot)));
    PEOPLE.forEach(function (person) {
      const state = personState(slot, person);
      column.appendChild(createElement("span", "day-chart-cell " + (state === "available" ? "is-available" : "is-unavailable")));
    });
    return column;
  }

  function createDayChartNameStack() {
    const labels = createElement("div", "day-chart-name-stack");
    labels.append(createElement("span"), createElement("span"));
    PEOPLE.forEach(function (person) {
      labels.appendChild(createElement("span", "day-chart-row-label", person.name));
    });
    return labels;
  }

  /* Read-only map of today, separate from the planner; rebuilds only when the day, past cutoff or zone changes. */
  function renderDayChart() {
    const grid = document.getElementById("day-chart-grid");
    const zone = zoneName(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    const dateRange = dayChartDateRange();
    const pastCutoff = nextSlotStart();
    const key = JSON.stringify([dateRange.dateString, dateRange.slots.length, pastCutoff, zone]);
    if (grid.dataset.key === key) return;
    const isNewDay = grid.dataset.date !== dateRange.dateString;

    const columns = dateRange.slots.map(function (slot, index) { return createDayChartColumn(slot, index, slot < pastCutoff); });
    grid.style.setProperty("--day-chart-slot-count", String(dateRange.slots.length));
    grid.setAttribute("aria-label", "Who is in their preferred hours today, " + formatDateLong(dateRange.dayStart, undefined) + ".");
    document.getElementById("day-chart-date").textContent = formatDateLong(dateRange.dayStart, undefined);
    document.getElementById("day-chart-zone").textContent = zone;
    grid.replaceChildren.apply(grid, [createDayChartNameStack()].concat(createDayChartBands(dateRange.slots), columns));
    grid.dataset.key = key;
    grid.dataset.date = dateRange.dateString;
    if (isNewDay) revealCurrentTime(grid);
  }

  /* On narrow screens, scrolls the chart itself (never the page) so the current time is in view. */
  function revealCurrentTime(grid) {
    const scroller = grid.parentElement;
    const current = grid.querySelector(".day-chart-column:not(.is-past)");
    if (!current || scroller.scrollWidth <= scroller.clientWidth) return;
    const labelWidth = grid.querySelector(".day-chart-name-stack").getBoundingClientRect().width;
    const currentLeft = current.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    scroller.scrollLeft += currentLeft - labelWidth - current.getBoundingClientRect().width * 2;
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

  /* Moves exactly 30 minutes, unavailable times included; the result line says who it's outside hours for. */
  function step(direction) {
    const next = planner.start + direction * SLOT_MS;
    if (next < nextSlotStart()) return;
    slideArrow(direction);
    moveTo(next);
    renderPlanner();
  }

  /* Time in the next 7 days with the fewest outside minutes, earliest on ties. */
  function findSoonestBest() {
    return findBestBetween(nextSlotStart(), nextSlotStart() + 7 * DAY_MS, minutesScore);
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
    input.min = deviceDateString(Date.now());
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
    if (best === null) {
      syncDateInput();
      return;
    }
    moveTo(best);
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
      planner.start = findSoonestBest();
      renderPlanner();
      renderDayChart();
      bindEvents();
      scheduleNextMinute();
    } catch (error) {
      document.getElementById("now-grid").textContent = "Times could not load in this browser.";
    }
  }

  startPage();
})();
