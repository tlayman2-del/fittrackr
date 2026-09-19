import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { auth, db } from "./firebase";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  doc, collection, addDoc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs, getDoc, getDocFromServer, getDocsFromServer
} from "firebase/firestore";

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;500;600;700&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --cream: #FFFFFF; --cream2: #F5F5F5; --cream3: #E8E8E8;
    --yellow: #F0C800; --orange: #1C1C1C; --orange2: #F0C800; --red: #c0251a; --pink: #e8305a;
    --black: #1C1C1C; --ink: #1C1C1C; --ink2: #4A4438; --ink3: #999999; --ink4: #BBBBBB;
    --green: #1a7a3a; --border: #D0CAC0;
    --card: #FFFFFF;
    --font-display: 'Bebas Neue', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --font-label: 'Oswald', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --font-body: 'Oswald', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  body.dark {
    --cream: #121110; --cream2: #1A1814; --cream3: #242018;
    --black: #E8E2D8; --ink: #E8E2D8; --ink2: #9A9080; --ink3: #4A4438; --ink4: #3A342A;
    --border: #2A2420; --green: #2ecc71; --card: #1A1814;
  }
  html, body, #root {
    height: 100%; width: 100%; background: var(--cream); color: var(--ink);
    font-family: var(--font-body); -webkit-font-smoothing: antialiased; overscroll-behavior: none;
  }
  input, select, button { font-family: var(--font-body); }
  body.dark input, body.dark select, body.dark textarea {
    background: #1A1814 !important; color: #E8E2D8 !important; border-color: #2A2420 !important;
  }
  body.dark button { color: var(--ink); }
  body.dark [data-white] { background: #1A1814 !important; border-color: #2A2420 !important; color: var(--ink) !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--cream2); }
  ::-webkit-scrollbar-thumb { background: var(--yellow); border-radius: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .fade-in { animation: fadeIn 0.25s ease forwards; }
  .stripe-accent { position: relative; }
  .stripe-accent::before {
    content: ''; position: absolute; left: 6px; top: 15px; width: 8px; height: 8px;
    background: var(--yellow);
  }
  .stripe-accent-active::before {
    background: var(--yellow);
  }
`;
const styleEl = document.createElement("style");
styleEl.textContent = globalCSS;
document.head.appendChild(styleEl);

// Restore dark mode before first paint
if (localStorage.getItem("fittrackr-dark") === "1") document.body.classList.add("dark");

import { EXERCISE_LIBRARY, EXERCISE_MAP, MUSCLE_GROUPS } from "./exerciseLibrary";
import { DEFAULT_WORKOUT_TYPES, WORKOUT_TYPE_ALIASES, BIAS_WORKOUT_TYPE_MAP, resolveWorkoutType } from "./workoutTypes";

const HI_THRESHOLD = 0.75;

// Partial reps count as half a rep each, at full weight.
function partialCount(s) { return Math.max(0, Math.round(parseFloat(s?.partials) || 0)); }
function effectiveReps(s) { return (Math.round(parseFloat(s?.reps) || 0)) + partialCount(s) * 0.5; }

// Shared hi-intensity volume calculation used by session stats, deload detection, readiness, and analytics
function computeSetVolumes(sets) {
  let totalVol = 0, hiVol = 0;
  for (const s of (sets || [])) {
    const reps = Math.round(parseFloat(s.reps) || 0);
    const partials = partialCount(s);
    const weight = parseFloat(s.weight) || 0;
    totalVol += (reps + partials * 0.5) * weight;
    if (weight > 0 && reps > 0) {
      const rir = (s.rir !== "" && s.rir !== null && s.rir !== undefined) ? parseFloat(s.rir) : 4;
      for (let n = 1; n <= reps; n++) {
        const rr = (reps - n) + rir;
        const e1rm = weight * (1 + rr / 30);
        if (weight / e1rm >= HI_THRESHOLD) hiVol += weight;
      }
    }
    // Partials happen past the point of full-ROM failure, so they always
    // qualify as high-intensity work — half a rep each, at full weight.
    if (weight > 0 && partials > 0) hiVol += partials * 0.5 * weight;
  }
  return { totalVol, hiVol };
}

const VOLUME_LANDMARKS = {
  Chest:      { mev: 10, mav: 16, mrv: 22 },
  Back:       { mev: 10, mav: 16, mrv: 25 },
  Shoulders:  { mev: 8,  mav: 14, mrv: 20 },
  Triceps:    { mev: 6,  mav: 12, mrv: 18 },
  Biceps:     { mev: 6,  mav: 12, mrv: 18 },
  Traps:      { mev: 6,  mav: 10, mrv: 16 },
  Core:       { mev: 6,  mav: 10, mrv: 16 },
  Quads:      { mev: 8,  mav: 14, mrv: 20 },
  Hamstrings: { mev: 6,  mav: 12, mrv: 18 },
  Glutes:     { mev: 6,  mav: 12, mrv: 18 },
  Calves:     { mev: 6,  mav: 10, mrv: 16 },
  Abductors:  { mev: 4,  mav: 8,  mrv: 12 },
  Adductors:  { mev: 4,  mav: 8,  mrv: 12 },
};

const MUSCLE_GROUP_MAPPINGS = Object.fromEntries(
  EXERCISE_LIBRARY.map(e => [e.name, { primaryGroup: e.primaryGroup, secondaryGroups: e.secondaryGroups }])
);

const REST_OPTIONS = Array.from({ length: 10 }, (_, i) => {
  const secs = (i + 1) * 30;
  const m = Math.floor(secs / 60), s = secs % 60;
  return { label: `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`, value: secs };
});

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Three-tone ascending chime, louder
    const tones = [523, 659, 784]; // C5, E5, G5
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.5);
    });
  } catch (e) {}
}
function vibrate() { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function today() { return new Date().toISOString().split("T")[0]; }

const APP_VERSION = "1.1";
const GITHUB_REPO = "tlayman2-del/fittrackr";

function computeSessionStats(exercises) {
  let totalVolume = 0, hiVolume = 0;
  for (const ex of exercises) {
    if (!ex.name) continue;
    const validSets = (ex.sets || []).filter(s => effectiveReps(s) > 0 && s.weight);
    const { totalVol, hiVol } = computeSetVolumes(validSets);
    totalVolume += totalVol;
    hiVolume += hiVol;
  }
  const hiPct = totalVolume > 0 ? Math.round((hiVolume / totalVolume) * 100) : 0;
  return { totalVolume: Math.round(totalVolume), hiPct };
}

function computeDeloadScore(recentWorkouts) {
  // recentWorkouts: array of {sleepQuality, energyLevel, postRating, hiPct, date}
  // Returns { score, sleepScore, energyScore, sessionScore, hiPctScore, count }
  const valid = recentWorkouts.filter(w =>
    w.sleepQuality != null && w.energyLevel != null &&
    w.postRating != null && w.hiPct != null
  );
  if (valid.length < 3) return null;

  const clamp = v => Math.max(-1, Math.min(1, v)); // allow negative for sleep
  const clamp0 = v => Math.max(0, Math.min(1, v)); // one-directional clamp

  // Recency weighting: last 5 days = 60% weight, days 6-14 = 40% weight
  const now = Date.now();
  const fiveDaysMs = 5 * 86400000;
  const recentSessions = valid.filter(w => (now - new Date(w.date + "T00:00:00").getTime()) <= fiveDaysMs);
  const olderSessions  = valid.filter(w => (now - new Date(w.date + "T00:00:00").getTime()) >  fiveDaysMs);

  function weightedAvg(key, isSession = false) {
    function sessionWeightedMean(sessions) {
      if (!sessions.length) return null;
      let weightedSum = 0, totalWeight = 0;
      for (const w of sessions) {
        // Poor session ratings (1-2) count at 2x weight
        const weight = isSession && w[key] <= 2 ? 2 : 1;
        weightedSum += w[key] * weight;
        totalWeight += weight;
      }
      return weightedSum / totalWeight;
    }
    const recentAvg = sessionWeightedMean(recentSessions);
    const olderAvg  = sessionWeightedMean(olderSessions);
    if (recentAvg === null && olderAvg === null) return null;
    if (recentAvg === null) return olderAvg;
    if (olderAvg  === null) return recentAvg;
    return recentAvg * 0.6 + olderAvg * 0.4;
  }

  const avgSleep   = weightedAvg("sleepQuality");
  const avgEnergy  = weightedAvg("energyLevel");
  const avgSession = weightedAvg("postRating", true);
  const avgHiPct   = weightedAvg("hiPct");

  if (avgSleep == null || avgEnergy == null || avgSession == null || avgHiPct == null) return null;

  // Sleep: bidirectional — 3=neutral(0), 1=+1 fatigue, 5=-1 fatigue
  const sleepScore   = clamp((3 - avgSleep) / 2);
  // Energy: one-directional — low hurts, 3+ contributes 0
  const energyScore  = clamp0((3 - avgEnergy) / 2);
  // Session: one-directional with 2x weight on poor sessions already in avg
  const sessionScore = clamp0((3 - avgSession) / 2);

  // Slope penalty: compare recent 3 sessions vs sessions 4-7 baseline
  // If declining, add penalty on top of session score
  let slopePenalty = 0;
  const sortedValid = [...valid].sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1); // newest first
  if (sortedValid.length >= 4) {
    const recent3 = sortedValid.slice(0, 3);
    const baseline = sortedValid.slice(3, 7);
    const recentAvgRating = recent3.reduce((s, w) => s + w.postRating, 0) / recent3.length;
    const baselineAvgRating = baseline.reduce((s, w) => s + w.postRating, 0) / baseline.length;
    if (recentAvgRating < baselineAvgRating) {
      slopePenalty = clamp0((baselineAvgRating - recentAvgRating) / 4);
    }
  }
  const sessionScoreFinal = clamp0(sessionScore + slopePenalty);
  // hi%: above 40% starts contributing
  const hiPctScore   = clamp0((avgHiPct - 40) / 60);

  const score = 0.30 * sleepScore + 0.10 * energyScore + 0.35 * sessionScoreFinal + 0.25 * hiPctScore;
  return { score, sleepScore, energyScore, sessionScore: sessionScoreFinal, hiPctScore, slopePenalty, count: valid.length };
}

// ── Fractional Set Calculator ─────────────────────────────────────────────────
// Computes primary and secondary set credits for a single exercise.
// Returns { primaryGroup, primarySets, secondarySets }
function computeFractionalSets(exerciseName, muscleGroup, sets) {
  const workingSets = (sets || []).filter(s => (s.reps && s.reps !== "0") || partialCount(s) > 0 || s.weight || s.duration || s.distance).length;
  const entry = EXERCISE_MAP[exerciseName];
  const primaryGroup = entry ? entry.primaryGroup : (muscleGroup || null);
  const secondarySets = {};
  if (entry && entry.secondaryGroups && workingSets > 0) {
    for (const [group, fraction] of Object.entries(entry.secondaryGroups)) {
      const credit = Math.round(workingSets * fraction * 10) / 10;
      if (credit > 0) secondarySets[group] = credit;
    }
  }
  return { primaryGroup, primarySets: workingSets, secondarySets };
}




const inputStyle = {
  width: "100%", padding: "9px 11px", background: "var(--card)",
  border: "1.5px solid var(--border)", borderRadius: 0,
  color: "var(--ink)", fontSize: 15, fontFamily: "var(--font-body)",
  outline: "none", transition: "border-color 0.15s", WebkitAppearance: "none",
};
const inputFocusStyle = { borderColor: "var(--yellow)" };
const labelStyle = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--ink3)",
  textTransform: "uppercase", marginBottom: 5, display: "block", fontFamily: "var(--font-label)",
};
const sectionLabelStyle = {
  fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", color: "var(--ink3)",
  textTransform: "uppercase", fontFamily: "var(--font-label)",
};
const btnStyle = (variant = "default") => ({
  padding: "10px 18px", borderRadius: 0, cursor: "pointer", fontSize: 13, fontWeight: 700,
  fontFamily: "var(--font-label)", letterSpacing: "0.10em", textTransform: "uppercase",
  transition: "all 0.15s", border: "none",
  ...(variant === "primary" ? { background: "var(--yellow)", color: "var(--black)" }
    : variant === "danger" ? { background: "var(--red)", color: "#EDE8DF", boxShadow: "0 2px 0 #7a1010" }
    : variant === "ghost" ? { background: "transparent", color: "var(--ink2)", border: "1.5px solid var(--border)" }
    : variant === "active" ? { background: "var(--yellow)", color: "var(--black)" }
    : { background: "var(--cream2)", color: "var(--ink)", border: "1.5px solid var(--border)" })
});

function StripeBar({ height = 6 }) {
  return <div style={{ height: 2.5, width: "100%", background: "var(--ink)" }} />;
}

function FocusInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      onFocus={e => { setFocused(true); if (props.onFocus) props.onFocus(e); }}
      onBlur={e => { setFocused(false); if (props.onBlur) props.onBlur(e); }}
      style={{ ...inputStyle, ...style, ...(focused ? inputFocusStyle : {}) }} />
  );
}

function ComboBox({ value, onChange, onCommit, onSelect, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value || "");
  const [focused, setFocused] = useState(false);
  const ref = useRef();
  useEffect(() => { setInput(value || ""); }, [value]);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);
  const filtered = options.filter(o => o.toLowerCase().includes(input.toLowerCase()));
  function handleSelect(val) {
    setInput(val); onChange(val); setOpen(false);
    if (onCommit) onCommit(val); if (onSelect) onSelect(val);
  }
  function handleChange(e) { setInput(e.target.value); onChange(e.target.value); setOpen(true); }
  function handleKeyDown(e) { if (e.key === "Enter" && input.trim()) { setOpen(false); if (onCommit) onCommit(input.trim()); } }
  function handleBlur() { setFocused(false); setTimeout(() => { if (onCommit && input.trim()) onCommit(input.trim()); }, 200); }
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={input} onChange={handleChange} onFocus={() => { setOpen(true); setFocused(true); }}
        onKeyDown={handleKeyDown} onBlur={handleBlur} placeholder={placeholder}
        style={{ ...inputStyle, ...(focused ? inputFocusStyle : {}) }} />
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: "var(--card)", border: "1.5px solid var(--yellow)", borderRadius: 0, zIndex: 500, maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
          {filtered.map(opt => (
            <div key={opt} onPointerDown={e => { e.preventDefault(); handleSelect(opt); }}
              style={{ padding: "10px 12px", cursor: "pointer", fontSize: 14, borderBottom: "1px solid var(--cream2)", fontFamily: "var(--font-body)", color: "var(--ink)" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--cream)"}
              onMouseLeave={e => e.currentTarget.style.background = "var(--card)"}
            >{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Star Rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange, size = 32 }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: size, lineHeight: 1, transition: "transform 0.1s", transform: hovered >= n ? "scale(1.15)" : "scale(1)" }}>
          {(hovered || value) >= n ? "⭐" : "☆"}
        </button>
      ))}
    </div>
  );
}

// ── Readiness Dropdown (1-5) ──────────────────────────────────────────────────
function ReadinessDropdown({ label, value, onChange }) {
  const options = [
    { value: 1, label: "1 — Poor" },
    { value: 2, label: "2 — Fair" },
    { value: 3, label: "3 — Good" },
    { value: 4, label: "4 — Great" },
    { value: 5, label: "5 — Excellent" },
  ];
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={{ ...labelStyle, fontSize: 13 }}>{label}</label>
      <select value={value || ""} onChange={e => onChange(Number(e.target.value))}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ ...inputStyle, fontSize: 16, padding: "11px 12px", color: value ? "var(--ink)" : "var(--ink4)", ...(focused ? inputFocusStyle : {}) }}>
        <option value="">Select...</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Template Selector Card ────────────────────────────────────────────────────
function TemplateSelector({ templates, onSelect, onSkip, onDelete }) {
  const [browsing, setBrowsing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(null);

  // Step 1 — choose how to start
  if (!browsing) {
    return (
      <div className="fade-in" style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>How would you like to start?</span>
        </div>
        <div style={{ padding: 12, display: "flex", gap: 10 }}>
          <button onClick={onSkip}
            style={{ ...btnStyle("ghost"), flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "auto" }}>
            <span style={{ fontSize: 28 }}>✏️</span>
            <span style={{ fontFamily: "var(--font-label)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Start Blank</span>
          </button>
          {templates.length > 0 && (
            <button onClick={() => setBrowsing(true)}
              style={{ ...btnStyle("primary"), flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "auto", boxShadow: "0 2px 0 var(--red)" }}>
              <span style={{ fontSize: 28 }}>📋</span>
              <span style={{ fontFamily: "var(--font-label)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Use Template</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Step 2 — browse templates
  function handleCardTap(t) {
    setExpanded(expanded === t.id ? null : t.id);
    setSelected(t.id);
  }

  return (
    <div className="fade-in" style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Choose a Template</span>
        </div>
        <button onClick={() => { setBrowsing(false); setSelected(null); setExpanded(null); }}
          style={{ background: "none", border: "none", color: "var(--ink3)", cursor: "pointer", fontSize: 13, fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
          ← Back
        </button>
      </div>
      <div style={{ padding: 12 }}>
        {templates.map(t => (
          <div key={t.id} style={{ marginBottom: 8 }}>
            <div onClick={() => handleCardTap(t)}
              style={{ padding: "12px 14px", borderRadius: expanded === t.id ? "3px 3px 0 0" : 3, border: `2px solid ${selected === t.id ? "var(--orange)" : "var(--border)"}`, borderBottom: expanded === t.id ? "none" : undefined, background: selected === t.id ? "var(--cream)" : "var(--card)", cursor: "pointer", transition: "all 0.15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "0.04em", color: selected === t.id ? "var(--orange)" : "var(--ink)", lineHeight: 1 }}>{t.name.toUpperCase()}</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
                    {t.exercises.length} exercise{t.exercises.length !== 1 ? "s" : ""}{t.workoutType ? ` · ${t.workoutType}` : ""}{t.exerciseGroup ? ` · ${t.exerciseGroup}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {onDelete && (
                    <button onClick={e => { e.stopPropagation(); onDelete(t); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--ink4)", padding: "2px 4px", lineHeight: 1 }}>🗑</button>
                  )}
                  <span style={{ fontSize: 12, color: "var(--orange)", fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
                    {expanded === t.id ? "▲" : "▼"}
                  </span>
                </div>
              </div>
            </div>
            {expanded === t.id && (
              <div style={{ padding: "10px 14px", background: "var(--cream)", borderRadius: "0 0 3px 3px", border: "2px solid var(--orange)", borderTop: "none" }}>
                {t.exercises.map((ex, i) => (
                  <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < t.exercises.length - 1 ? "1px solid var(--cream3)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--orange)", letterSpacing: "0.04em" }}>{ex.name.toUpperCase()}</span>
                      {ex.muscleGroup && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", textTransform: "uppercase" }}>{ex.muscleGroup}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink3)", fontFamily: "var(--font-label)" }}>
                      {ex.sets.length} set{ex.sets.length !== 1 ? "s" : ""} · {ex.sets.map(s => `${s.weight}lb × ${formatReps(s)}`).join(", ")}
                    </div>
                  </div>
                ))}
                <button onClick={() => onSelect(t)}
                  style={{ ...btnStyle("primary"), width: "100%", padding: "10px", marginTop: 6, boxShadow: "0 2px 0 var(--red)" }}>
                  Load Template
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function SignIn() {
  const [loading, setLoading] = useState(false);
  async function handleGoogle() {
    setLoading(true);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { console.error(e); setLoading(false); }
  }
  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}><StripeBar height={10} /></div>
      {/* Left yellow signal bar */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: "var(--yellow)" }} />
      <div style={{ textAlign: "center", maxWidth: 320, width: "100%" }}>
        {/* Moholy-Nagy circle as hero */}
        <div style={{ position: "relative", width: 100, height: 100, margin: "0 auto 20px" }}>
          <div style={{ position: "absolute", width: 100, height: 100, border: "2.5px solid var(--ink)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", width: 66, height: 66, top: 17, left: 17, background: "var(--yellow)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", width: 33, height: 33, top: 33.5, left: 33.5, background: "var(--ink)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", width: 10, height: 10, top: 45, left: 45, background: "var(--yellow)", borderRadius: "50%" }} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 0.85, color: "var(--ink)", letterSpacing: "0.04em", marginBottom: 16 }}>FIT<br/>TRACKR</h1>
        <p style={{ color: "var(--ink3)", marginBottom: 40, fontSize: 9, fontWeight: 300, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: "var(--font-label)" }}>Track every rep. Own your progress.</p>
        <button onClick={handleGoogle} disabled={loading} style={{ ...btnStyle("primary"), width: "100%", padding: "14px 24px", fontSize: 15, display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#1C1C1C" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#1C1C1C" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#1C1C1C" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#1C1C1C" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2.5, background: "var(--ink)" }} />
    </div>
  );
}

// ── Exercise History Panel ────────────────────────────────────────────────────
function ExerciseHistoryPanel({ exerciseName, uid, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function load() {
      try {
        const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
        const results = [];
        let scanned = 0;
        for (const wDoc of wSnap.docs) {
          if (results.length >= 4) break;
          if (scanned++ >= 30) break;
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          for (const eDoc of eSnap.docs) {
            if (eDoc.data().name === exerciseName) { results.push({ date: wDoc.data().date, ...eDoc.data() }); break; }
          }
        }
        setHistory(results);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, [exerciseName, uid]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={onClose}>
      <div className="fade-in" onClick={e => e.stopPropagation()} style={{ width: "100%", maxHeight: "75vh", background: "var(--cream)", borderRadius: "12px 12px 0 0", overflow: "hidden" }}>
        <StripeBar height={6} />
        <div style={{ padding: 20, overflowY: "auto", maxHeight: "calc(75vh - 6px)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ ...sectionLabelStyle, color: "var(--ink3)", fontSize: 10 }}>Exercise History</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1 }}>{exerciseName.toUpperCase()}</h2>
            </div>
            <button onClick={onClose} style={{ ...btnStyle("ghost"), padding: "6px 12px" }}>✕</button>
          </div>
          {loading ? <p style={{ color: "var(--ink3)", textAlign: "center", padding: 24 }}>Loading…</p>
            : history.length === 0 ? <p style={{ color: "var(--ink3)", textAlign: "center", padding: 24 }}>No history yet</p>
            : history.map((entry, i) => (
              <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < history.length - 1 ? "1.5px solid var(--cream3)" : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <div style={{ ...sectionLabelStyle, fontSize: 11, color: "var(--orange)" }}>{entry.date}</div>
                  {entry.order && <div style={{ fontSize: 10, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>exercise #{entry.order}</div>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 2fr", gap: 4 }}>
                  {["Set","Reps","Weight","RIR"].map(h => <div key={h} style={{ ...labelStyle, marginBottom: 2 }}>{h}</div>)}
                  {(entry.sets || []).map((set, j) => (
                    <>
                      <div key={`s${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{j + 1}</div>
                      <div key={`r${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{formatReps(set)}</div>
                      <div key={`w${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{set.weight}<span style={{ fontSize: 11, color: "var(--ink4)" }}>lb</span></div>
                      <div key={`i${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{set.rir ?? "—"}</div>
                    </>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Rest Timer ────────────────────────────────────────────────────────────────
function RestTimer({ restSecs, defaultRestSecs, onRestChange, onDone }) {
  const [remaining, setRemaining] = useState(restSecs);
  const [running, setRunning] = useState(true);
  const intervalRef = useRef(null);
  const endTimeRef = useRef(null); // absolute end time for screen-timeout resilience
  const doneRef = useRef(false);

  function computeRemaining() {
    if (!endTimeRef.current) return remaining;
    return Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000));
  }

  function startTimer(fromRemaining) {
    endTimeRef.current = Date.now() + fromRemaining * 1000;
    doneRef.current = false;
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const r = computeRemaining();
      setRemaining(r);
      if (r <= 0 && !doneRef.current) {
        doneRef.current = true;
        clearInterval(intervalRef.current);
        playBeep(); vibrate();
        setTimeout(() => { if (onDone) onDone(); }, 2000);
      }
    }, 500); // 500ms poll for snappier UI
  }

  useEffect(() => { setRemaining(restSecs); startTimer(restSecs); return () => clearInterval(intervalRef.current); }, [restSecs]);

  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return; }
    startTimer(remaining);
    return () => clearInterval(intervalRef.current);
  }, [running]);

  // Resync when screen wakes up
  useEffect(() => {
    function onVisible() {
      if (!running || doneRef.current) return;
      const r = computeRemaining();
      setRemaining(r);
      if (r <= 0 && !doneRef.current) {
        doneRef.current = true;
        clearInterval(intervalRef.current);
        playBeep(); vibrate();
        setTimeout(() => { if (onDone) onDone(); }, 2000);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running]);

  const pct = restSecs > 0 ? remaining / restSecs : 0;
  const done = remaining === 0;
  const barColor = done ? "var(--green)" : pct > 0.5 ? "var(--orange)" : pct > 0.25 ? "#e8a000" : "var(--red)";

  return (
    <div style={{ marginTop: 8, padding: "14px 14px 12px", background: done ? "#e8f5ee" : "var(--cream2)", border: `2px solid ${done ? "var(--green)" : "var(--orange)"}`, borderRadius: 4 }}>
      {/* Label + countdown */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-label)", fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: done ? "var(--green)" : "var(--orange)" }}>
          {done ? "Rest Complete!" : "Resting…"}
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: "0.04em", color: done ? "var(--green)" : "var(--ink)", lineHeight: 1 }}>
          {done ? "GO!" : formatTime(remaining)}
        </span>
      </div>

      {/* Vertical progress bar (drains downward) */}
      <div style={{ width: "100%", height: 18, background: "var(--cream3)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
        <div style={{
          height: "100%", borderRadius: 4,
          width: `${pct * 100}%`,
          background: barColor,
          transition: "width 0.9s linear, background 0.5s",
        }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select value={defaultRestSecs} onChange={e => onRestChange(Number(e.target.value))}
          style={{ ...inputStyle, padding: "7px 10px", fontSize: 15, flex: 1 }}>
          {REST_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {running && (
          <button onClick={() => { setRunning(false); if (onDone) onDone(); }}
            style={{ ...btnStyle("ghost"), padding: "8px 14px", fontSize: 14, whiteSpace: "nowrap" }}>Skip</button>
        )}
        {!running && remaining > 0 && (
          <button onClick={() => setRunning(true)}
            style={{ ...btnStyle("ghost"), padding: "8px 14px", fontSize: 14, whiteSpace: "nowrap" }}>Resume</button>
        )}
      </div>
    </div>
  );
}

// ── Set Row ───────────────────────────────────────────────────────────────────
const CARDIO_MUSCLE_GROUPS = new Set(["Cardio"]);

// Set-row grid templates. The partials column is narrower than the rest —
// it only ever holds a single digit or two.
const SET_GRID = "22px 1fr 1fr 1fr 28px";
const SET_GRID_PARTIALS = "22px 1fr 1fr 0.72fr 0.8fr 28px";

// True if any set in the exercise has partials logged — used to decide whether
// read-only views (history, templates) need to surface them.
function anySetHasPartials(sets) { return (sets || []).some(s => partialCount(s) > 0); }

// Drops UI-only keys and normalizes partials to a number (or omits the key
// entirely) so blank strings never reach Firestore.
function cleanSetForSave({ _prefilled, partials, ...s }) {
  const p = Math.max(0, Math.round(parseFloat(partials) || 0));
  return p > 0 ? { ...s, partials: p } : s;
}

async function updateExerciseStats(uid, exerciseList) {
  // exerciseList: [{ name, sets: [{reps, weight, rir, ...}] }]
  const statsRef = doc(db, "users", uid, "meta", "exerciseStats");
  const snap = await getDoc(statsRef);
  const stored = snap.exists() ? snap.data() : {};
  const updates = {};

  for (const { name, sets } of exerciseList) {
    if (!name || !sets?.length) continue;
    let bestZeroRIR = null;
    let bestEstimated = null;

    for (const set of sets) {
      const reps = Number(set.reps);
      const weight = Number(set.weight);
      if (!reps || !weight || reps < 3 || reps > 12) continue;
      const e1rm = weight * (1 + reps / 30);
      const rir = (set.rir !== "" && set.rir != null) ? Number(set.rir) : null;
      if (rir === 0) {
        if (bestZeroRIR === null || e1rm > bestZeroRIR) bestZeroRIR = e1rm;
      } else {
        if (bestEstimated === null || e1rm > bestEstimated) bestEstimated = e1rm;
      }
    }

    let candidate = null;
    if (bestZeroRIR !== null) candidate = { value: bestZeroRIR, source: "0-RIR" };
    else if (bestEstimated !== null) candidate = { value: bestEstimated, source: "estimated" };
    if (!candidate) continue;

    const current = stored[name];
    const isNewBest = !current || candidate.value > current.bestE1RM;
    const upgradedSource = current && candidate.source === "0-RIR" && current.bestE1RMSource === "estimated";
    if (isNewBest || upgradedSource) {
      updates[name] = {
        bestE1RM: Math.round(candidate.value * 10) / 10,
        bestE1RMSource: candidate.source,
        bestE1RMDate: new Date().toISOString().slice(0, 10),
        lastUpdated: serverTimestamp(),
      };
    }
  }

  if (Object.keys(updates).length > 0) {
    await setDoc(statsRef, updates, { merge: true });
  }
}

async function backfillExerciseStats(uid) {
  const statsRef = doc(db, "users", uid, "meta", "exerciseStats");
  const existing = await getDoc(statsRef);
  if (existing.exists() && Object.keys(existing.data()).length > 0) return;
  const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "asc")));
  const allExercises = [];
  await Promise.all(wSnap.docs.map(async wDoc => {
    const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
    for (const eDoc of eSnap.docs) {
      const ex = eDoc.data();
      if (ex.name && ex.sets?.length) allExercises.push({ name: ex.name, sets: ex.sets });
    }
  }));
  if (allExercises.length > 0) await updateExerciseStats(uid, allExercises);
}

// "8", "8+3p", or "3p" for a partials-only set.
function formatReps(set) {
  const reps = Math.round(parseFloat(set?.reps) || 0);
  const p = partialCount(set);
  if (!p) return set?.reps ? String(set.reps) : "";
  return reps > 0 ? `${reps}+${p}p` : `${p}p`;
}

function SetRow({ set, index, onChange, onRemove, defaultRestSecs, onRestChange, isActiveRest, onActivate, onRestDone, isCardio, onInteract, prWeightValue, showPartials, bestE1RM, isActiveRow }) {
  const fields = isCardio
    ? ["duration", "distance"]
    : ["reps", "weight", "partials", "rir"];
  const [fieldState, setFieldState] = useState(
    Object.fromEntries(fields.map(k => [k, { focused: false, typed: false }]))
  );
  const inputRefs = {
    reps: useRef(null),
    weight: useRef(null),
    partials: useRef(null),
    rir: useRef(null),
  };
  const rirFiredRef = useRef(false);  // prevents double-fire within one focus-blur cycle
  const rirLastValRef = useRef("");    // last value from onChange; takes priority over stale set.rir prop
  function getDisplayValue(key) { const fs = fieldState[key] || {}; if (set._prefilled && fs.focused && !fs.typed) return ""; return set[key] ?? ""; }
  function getColor(key) { const fs = fieldState[key] || {}; if (!set._prefilled) return "var(--ink)"; if (fs.typed || fs.focused) return "var(--ink)"; return "var(--ink4)"; }
  function handleFocus(key) {
    if (key === "rir") { rirFiredRef.current = false; rirLastValRef.current = ""; }
    setFieldState(prev => ({ ...prev, [key]: { focused: true, typed: false } }));
    setTimeout(() => { inputRefs[key]?.current?.select(); }, 0);
  }
  function handleChange(key, val) {
    if (key === "rir") rirLastValRef.current = val;
    if (onInteract && key !== "rir") onInteract();
    setFieldState(prev => ({ ...prev, [key]: { ...prev[key], typed: true } }));
    onChange({ ...set, [key]: val });
  }
  function activateRirTimer() {
    // Use last typed value if available, else fall back to current prop (handles tabbing through prefilled sets)
    const val = rirLastValRef.current !== "" ? rirLastValRef.current : String(set.rir ?? "");
    if (!rirFiredRef.current && val !== "") {
      rirFiredRef.current = true;
      rirLastValRef.current = "";
      setFieldState(prev => ({ ...prev, rir: { ...prev.rir, typed: false } }));
      onActivate();
      return true;
    }
    return false;
  }
  function handleBlur(key) {
    const fs = fieldState[key] || {};
    setFieldState(prev => ({ ...prev, [key]: { ...prev[key], focused: false } }));
    if (key === "rir") activateRirTimer();
    if (set._prefilled && !fs.typed) onChange({ ...set, _prefilled: false });
  }

  // Mobile: Enter/Done key fires timer; rirFiredRef prevents subsequent blur from double-firing
  function handleRirKeyUp(e) {
    if (e.key === "Enter" || e.keyCode === 13) {
      activateRirTimer();
    }
  }

  if (isCardio) {
    function handleDurationChange(val) {
      // Strip non-digits
      const digits = val.replace(/\D/g, '');
      // Auto-format: pad to at least 4 digits, last 2 = seconds, rest = minutes
      let formatted = val;
      if (digits.length >= 3) {
        const secs = digits.slice(-2);
        const mins = digits.slice(0, -2);
        formatted = `${mins}:${secs}`;
      }
      handleChange("duration", formatted);
    }
    return (
      <div className="fade-in" style={{ marginBottom: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 1fr 28px", gap: 5, alignItems: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink3)", textAlign: "center", lineHeight: 1 }}>{index + 1}</div>
          <input type="text" inputMode="numeric" placeholder="mm:ss"
            value={getDisplayValue("duration")} onFocus={() => handleFocus("duration")}
            onChange={e => handleDurationChange(e.target.value)} onBlur={() => handleBlur("duration")}
            style={{ ...inputStyle, textAlign: "center", color: getColor("duration"), fontWeight: 600, fontSize: 16, padding: "8px 4px" }} />
          <input type="number" inputMode="decimal" placeholder="mi"
            value={getDisplayValue("distance")} onFocus={() => handleFocus("distance")}
            onChange={e => handleChange("distance", e.target.value)} onBlur={() => handleBlur("distance")}
            style={{ ...inputStyle, textAlign: "center", color: getColor("distance"), fontWeight: 600, fontSize: 16, padding: "8px 4px" }} />
          <button onClick={onRemove} style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
        </div>
        {isActiveRest && <RestTimer restSecs={defaultRestSecs} defaultRestSecs={defaultRestSecs} onRestChange={onRestChange} onDone={onRestDone} />}
      </div>
    );
  }

  const cellInput = (key, mode, placeholder) => (
    <input ref={inputRefs[key]} type="number" inputMode={mode} placeholder={placeholder}
      value={getDisplayValue(key)} onFocus={() => handleFocus(key)}
      onChange={e => handleChange(key, e.target.value)} onBlur={() => handleBlur(key)}
      className={key === "reps" ? "set-row-reps" : undefined}
      style={{ ...inputStyle, textAlign: "center", color: getColor(key), fontWeight: 600, fontSize: 16, padding: "8px 4px",
        ...(key === "weight" && prWeightValue !== null && parseFloat(set.weight) === prWeightValue ? { background: "rgba(26,122,58,0.15)", borderColor: "var(--green)" } : {}) }}
      min={key === "rir" || key === "partials" ? 0 : undefined} max={key === "rir" ? 10 : undefined} />
  );
  const rirInput = (
    <input ref={inputRefs.rir} type="number" inputMode="numeric" placeholder="—"
      value={getDisplayValue("rir")} onFocus={() => handleFocus("rir")}
      onChange={e => handleChange("rir", e.target.value)} onBlur={() => handleBlur("rir")}
      onKeyUp={handleRirKeyUp}
      style={{ ...inputStyle, textAlign: "center", color: getColor("rir"), fontWeight: 600, fontSize: 16, padding: "8px 4px" }}
      min={0} max={10} />
  );
  const reps = Number(set.reps);
  const weight = Number(set.weight);
  const reportedRIR = (set.rir !== "" && set.rir != null) ? Number(set.rir) : null;
  let projectedRIR = null;
  if (isActiveRow && bestE1RM && weight > 0 && reps >= 3 && reps <= 12) {
    const predictedMaxReps = (bestE1RM / weight - 1) * 30;
    projectedRIR = Math.max(0, Math.min(10, Math.round(predictedMaxReps - reps)));
    if (!set._prefilled && reportedRIR !== null && projectedRIR === reportedRIR) projectedRIR = null;
  }

  return (
    <div className="fade-in" style={{ marginBottom: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: showPartials ? SET_GRID_PARTIALS : SET_GRID, gap: 5, alignItems: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink3)", textAlign: "center", lineHeight: 1 }}>{index + 1}</div>
        {cellInput("reps", "numeric", "—")}
        {cellInput("weight", "decimal", "—")}
        {showPartials && cellInput("partials", "numeric", "—")}
        {rirInput}
        <button onClick={onRemove} style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
      </div>
      {projectedRIR !== null && (
        <div style={{ textAlign: "right", paddingRight: 28, marginTop: 2, fontSize: 11, fontFamily: "var(--font-label)", letterSpacing: "0.04em",
          color: (reportedRIR !== null && Math.abs(projectedRIR - reportedRIR) >= 2) ? "var(--orange)" : "var(--ink4)" }}>
          proj. RIR {projectedRIR}
        </div>
      )}
      {isActiveRest && <RestTimer restSecs={defaultRestSecs} defaultRestSecs={defaultRestSecs} onRestChange={onRestChange} onDone={onRestDone} />}
    </div>
  );
}

// ── Exercise Card ─────────────────────────────────────────────────────────────
function ExerciseCard({ exercise, index, onChange, onRemove, uid, library, onAddToLibrary, isActive, paused, onSetActive, restPrefs, onRestPrefChange, activeRestKeys, onSetRestActive, onClearRestKey, activeElapsedRef, onInteract, onDragHandleTouchStart, onDragHandleMouseDown, dragMode, isDragged, onFocusNextExercise, onToggleSuperset }) {
  const [showHistory, setShowHistory] = useState(false);
  const [prWeightValue, setPrWeightValue] = useState(null);
  const [bestE1RM, setBestE1RM] = useState(null);
  const [elapsed, setElapsed] = useState(exercise.durationSec || 0);
  const intervalRef = useRef(null);
  const startRef = useRef(null);
  const accumulatedRef = useRef(exercise.durationSec || 0);
  const exerciseRef = useRef(exercise);
  const cardRef = useRef(null);
  const defaultRest = (exercise.name && restPrefs[exercise.name]) ? restPrefs[exercise.name] : 90;

  const programmaticFocusRef = useRef(false);

  function focusNextRepsAfterRest(currentSetIndex) {
    setTimeout(() => {
      if (!cardRef.current) { if (onFocusNextExercise) onFocusNextExercise(); return; }
      const repsInputs = Array.from(cardRef.current.querySelectorAll('.set-row-reps'));
      const nextEl = repsInputs[currentSetIndex + 1];
      if (nextEl) {
        programmaticFocusRef.current = true;
        nextEl.focus();
        nextEl.select();
        setTimeout(() => { programmaticFocusRef.current = false; }, 200);
      } else if (onFocusNextExercise) { onFocusNextExercise(); }
    }, 500);
  }

  useEffect(() => {
    if (!exercise.name) { setPrWeightValue(null); return; }
    let cancelled = false;
    async function fetchWeightPR() {
      try {
        const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
        const maxWeights = []; // max weight per workout, up to 6 entries
        let scanned = 0;
        for (const wDoc of wSnap.docs) {
          if (maxWeights.length >= 6 || scanned++ >= 35) break;
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          for (const eDoc of eSnap.docs) {
            if (eDoc.data().name === exercise.name) {
              let max = null;
              for (const s of (eDoc.data().sets || [])) {
                const w = parseFloat(s.weight);
                if (!isNaN(w) && (max === null || w > max)) max = w;
              }
              if (max !== null) maxWeights.push(max);
              break;
            }
          }
        }
        // First entry = most recent workout; rest = prior workouts
        // Expose the PR weight value so only the matching cell is highlighted
        const isPR = maxWeights.length >= 2 && maxWeights[0] > Math.max(...maxWeights.slice(1));
        if (!cancelled) setPrWeightValue(isPR ? maxWeights[0] : null);
      } catch (e) { console.error(e); }
    }
    fetchWeightPR();
    return () => { cancelled = true; };
  }, [exercise.name, uid]);

  useEffect(() => {
    if (!exercise.name || !uid) { setBestE1RM(null); return; }
    let cancelled = false;
    async function fetchE1RM() {
      try {
        const snap = await getDocFromServer(doc(db, "users", uid, "meta", "exerciseStats"));
        if (!cancelled && snap.exists()) {
          const data = snap.data()[exercise.name];
          setBestE1RM(data?.bestE1RM ?? null);
        } else if (!cancelled) {
          setBestE1RM(null);
        }
      } catch (e) { if (!cancelled) setBestE1RM(null); }
    }
    fetchE1RM();
    return () => { cancelled = true; };
  }, [exercise.name, uid]);

  // Keep exerciseRef current on every render to avoid stale closure on onChange
  useEffect(() => { exerciseRef.current = exercise; });

  useEffect(() => {
    // Auto-start timer as soon as this card becomes the active one
    if (isActive && !exercise.timerStarted) {
      onChange({ ...exercise, timerStarted: true });
    }
  }, [isActive]);

  useEffect(() => {
    // Superset exercises keep their timer running as long as they're started;
    // solo exercises only run while they're the active card.
    const isSuperset = !!exercise.supersetId;
    const shouldRun = exercise.timerStarted && (isActive || isSuperset) && !paused;
    if (shouldRun && !intervalRef.current) {
      startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const newElapsed = accumulatedRef.current + Math.floor((Date.now() - startRef.current) / 1000);
        setElapsed(newElapsed);
        if (activeElapsedRef) activeElapsedRef.current = newElapsed;
      }, 1000);
    }
    if (!shouldRun && intervalRef.current) {
      clearInterval(intervalRef.current); intervalRef.current = null;
      const added = Math.floor((Date.now() - (startRef.current || Date.now())) / 1000);
      accumulatedRef.current += added;
      startRef.current = null;
      onChange({ ...exerciseRef.current, durationSec: accumulatedRef.current });
    }
    return () => {};
  }, [exercise.timerStarted, exercise.supersetId, isActive, paused]);
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  // The partials column shows when explicitly toggled on, and stays on by itself
  // whenever any set already carries partials (prefill, template, resumed session).
  const showPartials = exercise.showPartials === true ||
    (exercise.showPartials !== false && anySetHasPartials(exercise.sets));
  function togglePartials() {
    if (showPartials) {
      // Hiding the column discards any partials so they can't silently
      // keep counting toward volume while invisible.
      onChange({ ...exercise, showPartials: false, sets: (exercise.sets || []).map(({ partials, ...s }) => s) });
    } else {
      onChange({ ...exercise, showPartials: true });
    }
  }

  function addSet() {
    const newSets = [...(exercise.sets || []), { weight: "", reps: "", rir: "" }];
    const updated = { ...exercise, sets: newSets, timerStarted: true };
    onChange(updated);
  }
  function updateSet(i, val) { const sets = [...exercise.sets]; sets[i] = val; onChange({ ...exercise, sets }); }
  function removeSet(i) { onChange({ ...exercise, sets: exercise.sets.filter((_, idx) => idx !== i) }); }
  function handleRestChange(secs) { if (exercise.name) onRestPrefChange(exercise.name, secs); }

  async function handleExerciseSelect(name) {
    try {
      const libraryEntry = EXERCISE_LIBRARY.find(e => e.name.toLowerCase() === name.toLowerCase());
      const autoGroup = libraryEntry ? (libraryEntry.primaryGroup || libraryEntry.muscleGroup) : exercise.muscleGroup || "";

      // Only fetch last 4 matches for speed
      const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
      let found = null;
      let checked = 0;
      for (const wDoc of wSnap.docs) {
        if (checked >= 20) break; // cap total workouts scanned
        checked++;
        const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
        for (const eDoc of eSnap.docs) {
          if (eDoc.data().name === name) {
            found = eDoc.data();
            break;
          }
        }
        if (found) break;
      }
      if (found) {
        const lastSets = (found.sets || []).map(s => ({ ...s, _prefilled: true }));
        // Reset any manual toggle so prefilled partials can't stay hidden while
        // still counting toward volume.
        onChange({ ...exercise, name, muscleGroup: found.muscleGroup || autoGroup, showPartials: undefined, sets: lastSets.length > 0 ? lastSets : [{ weight: "", reps: "", rir: "" }] });
      } else {
        onChange({ ...exercise, name, muscleGroup: autoGroup, showPartials: undefined });
      }
    } catch (e) { onChange({ ...exercise, name }); }
  }

  // ── Compact drag mode view ──────────────────────────────────────────────────
  if (dragMode) {
    return (
      <div style={{
        background: isDragged ? "var(--cream2)" : "var(--card)",
        border: isDragged ? "1.5px solid var(--yellow)" : "1.5px solid var(--border)",
        borderLeft: isDragged ? "4px solid var(--yellow)" : "4px solid var(--yellow)",
        borderRadius: 4,
        padding: "12px 14px",
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: isDragged ? 0.5 : 1,
        boxShadow: isDragged ? "0 4px 16px rgba(240,200,0,0.3)" : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "opacity 0.15s, box-shadow 0.15s, border-color 0.15s",
      }}>
        <div
          onTouchStart={onDragHandleTouchStart}
          onMouseDown={onDragHandleMouseDown}
          style={{ fontSize: 22, color: isDragged ? "var(--orange)" : "var(--ink3)", cursor: isDragged ? "grabbing" : "grab", padding: "4px 6px", lineHeight: 1, userSelect: "none", touchAction: "none", flexShrink: 0 }}>≡</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-label)", fontSize: 10, color: "var(--ink4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Exercise {index + 1}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: isDragged ? "var(--orange)" : "var(--ink)", letterSpacing: "0.03em", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {exercise.name ? exercise.name.toUpperCase() : <span style={{ color: "var(--ink4)" }}>UNNAMED</span>}
          </div>
          {exercise.muscleGroup && (
            <div style={{ fontFamily: "var(--font-label)", fontSize: 10, color: "var(--ink4)", letterSpacing: "0.06em", marginTop: 2 }}>{exercise.muscleGroup}</div>
          )}
        </div>
        {(exercise.sets || []).filter(s => s.reps || s.weight || s.partials || s.duration).length > 0 && (
          <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--ink4)", letterSpacing: "0.04em", flexShrink: 0 }}>
            {(exercise.sets || []).filter(s => s.reps || s.weight || s.partials || s.duration).length} sets
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={cardRef} className={`fade-in stripe-accent${isActive ? " stripe-accent-active" : ""}`} onClick={e => { if (programmaticFocusRef.current) return; onSetActive(); }} style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 0, padding: "14px 14px 14px 20px", marginBottom: 10, boxShadow: isActive ? "0 2px 8px rgba(240,200,0,0.10)" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, marginRight: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div
              onTouchStart={onDragHandleTouchStart}
              onMouseDown={onDragHandleMouseDown}
              style={{ fontSize: 20, color: "var(--ink4)", cursor: "grab", padding: "2px 4px", lineHeight: 1, userSelect: "none", touchAction: "none", flexShrink: 0 }}
              title="Hold to reorder">≡</div>
            <div style={{ ...labelStyle, color: isActive ? "var(--orange)" : "var(--ink3)", marginBottom: 0 }}>Exercise {index + 1}</div>
          </div>

          {/* Step 1: Muscle group */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Muscle Group</label>
            <select value={exercise.muscleGroup || ""}
              onChange={e => onChange({ ...exercise, muscleGroup: e.target.value, name: "", timerStarted: exercise.timerStarted })}
              style={{ ...inputStyle, fontSize: 15, color: exercise.muscleGroup ? "var(--ink)" : "var(--ink4)", padding: "9px 11px" }}>
              <option value="">Select muscle group…</option>
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Step 2: Exercise name filtered by muscle group */}
          <div>
            <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Exercise Name</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <ComboBox
                  value={exercise.name}
                  onChange={val => onChange({ ...exercise, name: val })}
                  onSelect={handleExerciseSelect}
                  options={(() => {
                    const all = library.exercises || [];
                    if (!exercise.muscleGroup) return [...all].sort((a, b) => a.localeCompare(b));
                    const inGroup = EXERCISE_LIBRARY
                      .filter(e => (e.primaryGroup || e.muscleGroup) === exercise.muscleGroup)
                      .map(e => e.name);
                    const customMappings = library.muscleGroupMappings || {};
                    const filtered = all.filter(name =>
                      inGroup.some(n => n.toLowerCase() === name.toLowerCase()) ||
                      customMappings[name]?.primaryGroup === exercise.muscleGroup
                    );
                    return filtered.sort((a, b) => a.localeCompare(b));
                  })()}
                  placeholder={exercise.muscleGroup ? `${exercise.muscleGroup} exercises…` : "Select muscle group first…"}
                />
                {exercise.name && exercise.name.trim() && !(library.exercises || []).map(e => e.toLowerCase()).includes(exercise.name.trim().toLowerCase()) && (
                  <button onMouseDown={e => { e.preventDefault(); onAddToLibrary("exercises", exercise.name.trim(), exercise.muscleGroup); }}
                    style={{ marginTop: 5, width: "100%", padding: "7px 8px", background: "transparent", border: "1.5px dashed var(--orange2)", borderRadius: 3, color: "var(--orange)", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-label)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
                    + Save "{exercise.name.trim()}" to library
                  </button>
                )}
              </div>
              {exercise.name && <button onClick={() => setShowHistory(true)} style={{ ...btnStyle("ghost"), padding: "7px 10px", fontSize: 14 }}>📋</button>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
{exercise.timerStarted && (isActive || !!exercise.supersetId) && (
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: paused ? "var(--ink3)" : "var(--orange)", background: "var(--cream)", padding: "3px 8px", borderRadius: 3, letterSpacing: "0.04em", border: "1.5px solid var(--cream3)" }}>
              {paused ? "⏸ " : ""}{formatTime(elapsed)}
            </div>
          )}
          {exercise.timerStarted && !(isActive || !!exercise.supersetId) && (exercise.durationSec || 0) > 0 && (
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink4)", background: "var(--cream)", padding: "3px 8px", borderRadius: 3, letterSpacing: "0.04em" }}>{formatTime(exercise.durationSec || 0)} ✓</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18 }}>🗑</button>
          </div>
        </div>
      </div>

      {exercise.sets?.length > 0 && (() => {
        const isCardio = CARDIO_MUSCLE_GROUPS.has(exercise.muscleGroup);
        return (
          <div style={{ display: "grid", gridTemplateColumns: isCardio ? "22px 1fr 1fr 28px" : (showPartials ? SET_GRID_PARTIALS : SET_GRID), gap: 5, marginBottom: 4, paddingBottom: 4, borderBottom: "1.5px solid var(--cream3)" }}>
            <div />
            {isCardio ? (
              <>
                <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Duration</div>
                <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Dist (mi)</div>
              </>
            ) : (
              <>
                <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Reps</div>
                <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Weight</div>
                {showPartials && <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0, color: "var(--orange)" }}>Part</div>}
                <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>RIR</div>
              </>
            )}
            <div />
          </div>
        );
      })()}

      {(exercise.sets || []).map((set, i) => {
        const restKey = `${exercise.id}-${i}`;
        const isCardio = CARDIO_MUSCLE_GROUPS.has(exercise.muscleGroup);
        return (
          <SetRow key={i} set={set} index={i} onChange={val => updateSet(i, val)} onRemove={() => removeSet(i)}
            defaultRestSecs={defaultRest} onRestChange={handleRestChange} isCardio={isCardio}
            isActiveRest={!!activeRestKeys?.[restKey]} onActivate={() => onSetRestActive(restKey)}
            onRestDone={() => { onClearRestKey(restKey); focusNextRepsAfterRest(i); }}
            onInteract={onInteract} prWeightValue={prWeightValue}
            showPartials={showPartials && !isCardio}
            bestE1RM={bestE1RM}
            isActiveRow={true}
            />
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={addSet} style={{ ...btnStyle("ghost"), flex: 1, fontSize: 12, color: "var(--orange)", borderColor: "var(--orange2)", borderStyle: "dashed" }}>+ Add Set</button>
        {!CARDIO_MUSCLE_GROUPS.has(exercise.muscleGroup) && (
          <button onClick={togglePartials}
            title={showPartials ? "Hide the partials column" : "Log partial reps for this exercise"}
            style={{ ...btnStyle("ghost"), flexShrink: 0, fontSize: 12, padding: "8px 10px", whiteSpace: "nowrap",
              color: showPartials ? "var(--orange)" : "var(--ink3)",
              borderColor: showPartials ? "var(--orange2)" : "var(--border)",
              borderStyle: showPartials ? "solid" : "dashed" }}>
            {showPartials ? "− Partials" : "+ Partials"}
          </button>
        )}
        {onToggleSuperset && (
          <button onClick={onToggleSuperset}
            title={exercise.supersetId ? "Remove from superset" : "Link with next exercise as superset"}
            style={{ ...btnStyle("ghost"), flexShrink: 0, fontSize: 12, padding: "8px 10px", whiteSpace: "nowrap",
              color: exercise.supersetId ? "var(--orange)" : "var(--ink3)",
              borderColor: exercise.supersetId ? "var(--orange2)" : "var(--border)",
              borderStyle: exercise.supersetId ? "solid" : "dashed" }}>
            {exercise.supersetId ? "🔗 Super" : "🔗"}
          </button>
        )}
      </div>
      {showHistory && exercise.name && <ExerciseHistoryPanel exerciseName={exercise.name} uid={uid} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

// ── Active Workout ────────────────────────────────────────────────────────────
const WORKOUT_DRAFT_KEY = "fittrackr-draft-workout";

function saveWorkoutDraft(state) {
  try { localStorage.setItem(WORKOUT_DRAFT_KEY, JSON.stringify(state)); } catch (e) {}
}
function loadWorkoutDraft() {
  try { const s = localStorage.getItem(WORKOUT_DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function clearWorkoutDraft() {
  try { localStorage.removeItem(WORKOUT_DRAFT_KEY); } catch (e) {}
}


// ── Session Summary Screen ────────────────────────────────────────────────────
function SessionSummaryScreen({ stats, onDismiss }) {
  const { totalVolume, hiPct } = stats;
  const hiColor = hiPct >= 60 ? "var(--orange)" : hiPct >= 40 ? "var(--ink2)" : "#4a90d9";
  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div className="fade-in" style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ background: "var(--card)", borderRadius: 4, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
          <StripeBar height={6} />
          <div style={{ padding: 28 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--orange)", letterSpacing: "0.18em", marginBottom: 4 }}>SESSION COMPLETE</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 36, letterSpacing: "0.04em", color: "var(--ink)", lineHeight: 1, marginBottom: 28 }}>
              GOOD WORK.
            </h2>

            {/* Total Volume */}
            <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1.5px solid var(--cream3)" }}>
              <div style={{ ...sectionLabelStyle, fontSize: 10, marginBottom: 6 }}>Total Volume</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 48, color: "var(--ink)", letterSpacing: "0.02em", lineHeight: 1 }}>
                  {totalVolume.toLocaleString()}
                </span>
                <span style={{ fontFamily: "var(--font-label)", fontSize: 14, color: "var(--ink3)", letterSpacing: "0.08em" }}>LBS</span>
              </div>
            </div>

            {/* Hi-Intensity % */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ ...sectionLabelStyle, fontSize: 10, marginBottom: 6 }}>High-Intensity Volume</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 48, color: hiColor, letterSpacing: "0.02em", lineHeight: 1 }}>
                  {hiPct}
                </span>
                <span style={{ fontFamily: "var(--font-label)", fontSize: 20, color: hiColor, letterSpacing: "0.06em" }}>%</span>
              </div>
              {/* Bar */}
              <div style={{ marginTop: 10, height: 8, background: "var(--cream3)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${hiPct}%`, background: hiColor, borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
                {hiPct >= 60 ? "High intensity session — monitor recovery" : hiPct >= 40 ? "Balanced intensity distribution" : "Primarily sub-threshold work"}
              </div>
            </div>

            <button onClick={onDismiss} style={{ ...btnStyle("primary"), width: "100%", padding: "14px", fontSize: 15, boxShadow: "0 3px 0 var(--red)" }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Drag-to-Reorder Hook ───────────────────────────────────────────────────────
function useDragReorder(items, onReorder, onDragModeChange) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [dragMode, setDragMode] = useState(false);
  const longPressTimer = useRef(null);
  const cardRefs = useRef([]);
  const isDragging = useRef(false);
  const restoreTimer = useRef(null);
  // Snapshot of card midpoints captured at drag activation (before collapse re-render)
  const cardMidpoints = useRef([]);
  const currentDragIndexRef = useRef(null);
  const currentOverIndexRef = useRef(null);

  function snapshotMidpoints() {
    cardMidpoints.current = cardRefs.current.map(el => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
  }

  function activateDrag(index) {
    // Snapshot positions BEFORE state change collapses cards
    snapshotMidpoints();
    isDragging.current = true;
    currentDragIndexRef.current = index;
    currentOverIndexRef.current = index;
    setDragMode(true);
    setDragIndex(index);
    setOverIndex(index);
    if (onDragModeChange) onDragModeChange(true);
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function commitDrag(fromIndex, toIndex) {
    if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
      const next = [...items];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      onReorder(next);
    }
    isDragging.current = false;
    currentDragIndexRef.current = null;
    currentOverIndexRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
    restoreTimer.current = setTimeout(() => {
      setDragMode(false);
      if (onDragModeChange) onDragModeChange(false);
    }, 500);
  }

  function updateOverFromY(y) {
    // After collapse, midpoints are stale — recompute from current DOM
    const mids = cardRefs.current.map(el => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    let best = 0;
    let bestDist = Math.abs(y - mids[0]);
    for (let i = 1; i < mids.length; i++) {
      const d = Math.abs(y - mids[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    currentOverIndexRef.current = best;
    setOverIndex(best);
  }

  // ── Touch handlers ───────────────────────────────────────────────────────────
  function handleHandleTouchStart(index, e) {
    e.stopPropagation();
    clearTimeout(restoreTimer.current);
    longPressTimer.current = setTimeout(() => activateDrag(index), 500);
  }

  function handleHandleTouchMove(e) {
    if (!isDragging.current) { clearTimeout(longPressTimer.current); return; }
    e.preventDefault();
    updateOverFromY(e.touches[0].clientY);
  }

  function handleHandleTouchEnd() {
    clearTimeout(longPressTimer.current);
    if (!isDragging.current) return;
    commitDrag(currentDragIndexRef.current, currentOverIndexRef.current);
  }

  // ── Mouse handlers (desktop) ─────────────────────────────────────────────────
  function handleHandleMouseDown(index, e) {
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(restoreTimer.current);
    longPressTimer.current = setTimeout(() => activateDrag(index), 500);

    function onMouseMove(ev) {
      if (!isDragging.current) { clearTimeout(longPressTimer.current); return; }
      updateOverFromY(ev.clientY);
    }
    function onMouseUp() {
      clearTimeout(longPressTimer.current);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (!isDragging.current) return;
      commitDrag(currentDragIndexRef.current, currentOverIndexRef.current);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function setCardRef(index, el) {
    cardRefs.current[index] = el;
  }

  return {
    dragIndex, overIndex, dragMode,
    handleHandleTouchStart,
    handleHandleTouchMove,
    handleHandleTouchEnd,
    handleHandleMouseDown,
    setCardRef,
  };
}

function ActiveWorkout({ uid, user, library, onAddToLibrary, onEnd, restPrefs, onRestPrefChange, templates, onSaveTemplate, pendingTemplate }) {
  const draft = loadWorkoutDraft();

  const [workout, setWorkout] = useState(draft?.workout || { date: today(), location: "", workoutType: "", exerciseGroup: "", bodyWeight: "" });
  const [exercises, setExercises] = useState(draft?.exercises || []);
  const [totalSeconds, setTotalSeconds] = useState(draft?.totalSeconds || 0);
  // Wall-clock refs so the timer never drifts when the app is backgrounded
  const activeMsRef = useRef((draft?.totalSeconds || 0) * 1000);
  const activeStartMsRef = useRef(
    (draft?.workoutStarted && !(draft?.paused)) ? Date.now() : null
  );
  const [paused, setPaused] = useState(draft ? (draft.paused ?? false) : false);
  const [workoutStarted, setWorkoutStarted] = useState(draft?.workoutStarted || false);
  const [saving, setSaving] = useState(false);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(draft?.activeExerciseIndex ?? null);
  const [activeRestKeys, setActiveRestKeys] = useState({});
  const addRestKey = key => setActiveRestKeys(prev => ({...prev, [key]: true}));
  const removeRestKey = key => setActiveRestKeys(prev => { const n = {...prev}; delete n[key]; return n; });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [postRating, setPostRating] = useState(0);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState(draft?.templateName || "");
  const [templateNameFocused, setTemplateNameFocused] = useState(false);
  const [loadedTemplateId, setLoadedTemplateId] = useState(draft?.loadedTemplateId || null);
  const [showTemplateConflict, setShowTemplateConflict] = useState(false);
  const [templateSelectorDismissed, setTemplateSelectorDismissed] = useState(draft ? true : !!pendingTemplate);
  // Pre-workout readiness
  const [readinessDone, setReadinessDone] = useState(draft?.readinessDone || false);
  const [sleepQuality, setSleepQuality] = useState(draft?.sleepQuality || 0);
  const [energyLevel, setEnergyLevel] = useState(draft?.energyLevel || 0);
  const totalTimerRef = useRef(null);
  const activeElapsedRef = useRef(0); // live elapsed for currently active exercise
  const [sessionStats, setSessionStats] = useState(null); // set after save to show summary screen

  // Auto-load pendingTemplate on first mount (from Templates tab)
  useEffect(() => {
    if (pendingTemplate && !draft) {
      loadTemplate(pendingTemplate);
    }
  }, []);

  useEffect(() => {
    if (workoutStarted && !paused && !totalTimerRef.current) {
      totalTimerRef.current = setInterval(() => {
        const ms = activeMsRef.current + (activeStartMsRef.current ? Date.now() - activeStartMsRef.current : 0);
        setTotalSeconds(Math.round(ms / 1000));
      }, 1000);
    }
    if (paused && totalTimerRef.current) { clearInterval(totalTimerRef.current); totalTimerRef.current = null; }
  }, [workoutStarted, paused]);
  useEffect(() => () => { if (totalTimerRef.current) clearInterval(totalTimerRef.current); }, []);

  // Auto-save draft to localStorage on every meaningful state change
  useEffect(() => {
    if (!workoutStarted && exercises.length === 0) return; // nothing to save yet
    saveWorkoutDraft({
      workout, exercises, totalSeconds, workoutStarted, paused,
      activeExerciseIndex, readinessDone, sleepQuality, energyLevel,
      templateName, loadedTemplateId,
    });
  }, [workout, exercises, totalSeconds, workoutStarted, paused, activeExerciseIndex,
      readinessDone, sleepQuality, energyLevel, templateName, loadedTemplateId]);

  function addExercise() {
    const newIndex = exercises.length;
    setExercises(prev => [...prev, { id: Date.now(), name: "", muscleGroup: "", sets: [{ weight: "", reps: "", rir: "" }], timerStarted: false }]);
    setActiveExerciseIndex(newIndex);
    // Don't clear rest timers here — let any running rest timers keep going
    // until the user actually starts entering data in the new exercise
    if (!workoutStarted) {
      activeMsRef.current = 0;
      activeStartMsRef.current = Date.now();
      setWorkoutStarted(true);
    }
  }
  function togglePause() {
    setPaused(p => {
      if (!p) {
        if (activeStartMsRef.current) {
          activeMsRef.current += Date.now() - activeStartMsRef.current;
          activeStartMsRef.current = null;
        }
      } else {
        activeStartMsRef.current = Date.now();
      }
      return !p;
    });
  }
  function updateExercise(id, val) {
    setExercises(prev => prev.map(e => {
      if (e.id !== id) return e;
      // Always preserve supersetId from current state — only toggleSuperset
      // is allowed to change it. ExerciseCard closures must not clobber it.
      return { ...val, supersetId: e.supersetId };
    }));
  }
  function removeExercise(id) {
    setExercises(prev => { const next = prev.filter(e => e.id !== id); setActiveExerciseIndex(next.length > 0 ? next.length - 1 : null); return next; });
  }
  function toggleSuperset(id) {
    setExercises(prev => {
      const idx = prev.findIndex(e => e.id === id);
      const ex = prev[idx];
      if (ex.supersetId) {
        // Unlink: if only one other member remains, also clear their supersetId
        const siblings = prev.filter(e => e.supersetId === ex.supersetId && e.id !== id);
        return prev.map(e => {
          if (e.id === id) return { ...e, supersetId: undefined };
          if (siblings.length === 1 && e.supersetId === ex.supersetId) return { ...e, supersetId: undefined };
          return e;
        });
      }
      // Link: join with next card, or previous if last
      const partnerId = idx < prev.length - 1 ? prev[idx + 1].id : (idx > 0 ? prev[idx - 1].id : null);
      if (!partnerId) return prev;
      const partner = prev.find(e => e.id === partnerId);
      const ssId = partner.supersetId || `ss-${Date.now()}`;
      return prev.map(e => (e.id === id || e.id === partnerId) ? { ...e, supersetId: ssId } : e);
    });
  }
  const dragReorder = useDragReorder(exercises, newOrder => {
    setExercises(newOrder);
  });

  function loadTemplate(template) {
    setTemplateSelectorDismissed(true);
    setLoadedTemplateId(template.id);
    setTemplateName(template.name);
    if (template.workoutType) setWorkout(w => ({ ...w, workoutType: template.workoutType }));
    if (template.exerciseGroup) setWorkout(w => ({ ...w, exerciseGroup: template.exerciseGroup }));
    const loaded = template.exercises.map((ex, i) => ({
      id: Date.now() + i,
      name: ex.name,
      muscleGroup: ex.muscleGroup || "",
      timerStarted: false,
      sets: (ex.sets || []).map(s => ({ ...s, _prefilled: true })),
    }));
    setExercises(loaded);
    setActiveExerciseIndex(loaded.length > 0 ? 0 : null);
  }

  async function handleEndWorkout() {
    if (saveAsTemplate && templateName.trim()) {
      // Check if loaded from a template — offer overwrite or new
      if (loadedTemplateId) {
        setShowTemplateConflict(true);
        return;
      }
      await saveTemplateAndEnd(false);
    } else {
      await endWorkout();
    }
  }

  async function saveTemplateAndEnd(overwrite) {
    setShowTemplateConflict(false);
    const templateData = {
      name: templateName.trim(),
      workoutType: workout.workoutType || "",
      exerciseGroup: workout.exerciseGroup || "",
      exercises: exercises.filter(ex => ex.name).map(ex => ({
        name: ex.name,
        muscleGroup: ex.muscleGroup || "",
        sets: (ex.sets || []).filter(s => s.reps || s.weight || s.partials || s.duration || s.distance).map(cleanSetForSave),
      })),
      updatedAt: serverTimestamp(),
    };
    try {
      if (overwrite && loadedTemplateId) {
        await setDoc(doc(db, "users", uid, "templates", loadedTemplateId), templateData);
      } else {
        await addDoc(collection(db, "users", uid, "templates"), { ...templateData, createdAt: serverTimestamp() });
      }
      if (onSaveTemplate) onSaveTemplate();
    } catch (e) { console.error("Template save error:", e); }
    await endWorkout();
  }

  async function endWorkout() {
    setSaving(true);
    try {
      if (workout.location) onAddToLibrary("locations", workout.location);
      if (workout.workoutType) onAddToLibrary("workoutTypes", workout.workoutType);
      if (workout.exerciseGroup) onAddToLibrary("exerciseGroups", workout.exerciseGroup);

      // Pre-compute per-exercise data so we can derive an accurate total before writing the workout doc.
      // The per-exercise timers use absolute wall-clock references and are accurate across
      // background/foreground transitions; totalSeconds (setInterval) may lag on mobile.
      const exerciseDataList = exercises.map((ex, i) => {
        if (!ex.name) return null;
        const cleanSets = ex.sets.filter(s => s.reps || s.weight || s.partials || s.duration || s.distance).map(cleanSetForSave);
        const durationSec = (i === activeExerciseIndex && activeElapsedRef.current > 0)
          ? activeElapsedRef.current : (ex.durationSec || 0);
        const { primaryGroup, primarySets, secondarySets } = computeFractionalSets(ex.name, ex.muscleGroup, cleanSets);
        return { ex, i, cleanSets, durationSec, primaryGroup, primarySets, secondarySets };
      }).filter(Boolean);

      const elapsedMs = activeMsRef.current + (activeStartMsRef.current ? Date.now() - activeStartMsRef.current : 0);
      const effectiveTotalSeconds = Math.round(elapsedMs / 1000);

      const wRef = await addDoc(collection(db, "users", uid, "workouts"), {
        date: workout.date, location: workout.location, workoutType: workout.workoutType,
        exerciseGroup: workout.exerciseGroup, totalSeconds: effectiveTotalSeconds, createdAt: serverTimestamp(),
        bodyWeight: workout.bodyWeight ? Number(workout.bodyWeight) : null,
        sleepQuality: sleepQuality || null, energyLevel: energyLevel || null,
        postRating: postRating || null,
        userName: user.displayName || null,
      });
      for (const { ex, i, cleanSets, durationSec, primaryGroup, primarySets, secondarySets } of exerciseDataList) {
        await addDoc(collection(db, "users", uid, "workouts", wRef.id, "exercises"), {
          name: ex.name, order: i + 1, sets: cleanSets, muscleGroup: ex.muscleGroup || null,
          durationSec: durationSec || null, primaryGroup, primarySets, secondarySets,
          supersetId: ex.supersetId || null,
        });
        onAddToLibrary("exercises", ex.name, ex.muscleGroup);
      }
      await updateExerciseStats(uid, exerciseDataList.map(({ ex, cleanSets }) => ({ name: ex.name, sets: cleanSets })));
      clearWorkoutDraft();
      const stats = computeSessionStats(exercises);
      setSessionStats(stats);
    } catch (e) { console.error(e); alert("Error saving workout"); }
    setSaving(false);
  }

  // Show session summary after successful save
  if (sessionStats) return <SessionSummaryScreen stats={sessionStats} onDismiss={onEnd} />;

  // Bug report available during active workout
  const activeBugButton = <BugReportButton uid={uid} currentTab="active-workout" />;

  const metaComplete = workout.date && workout.location && workout.workoutType && workout.exerciseGroup;
  const metaMissing = [!workout.date && "date", !workout.location && "location", !workout.workoutType && "type", !workout.exerciseGroup && "group"].filter(Boolean);
  const readinessComplete = sleepQuality > 0 && energyLevel > 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", paddingBottom: 100 }}>
      {activeBugButton}
      {/* Top bar */}
      <div style={{ background: "var(--cream)", borderBottom: "2.5px solid var(--ink)" }}>
        <StripeBar height={5} />
        <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, color: "var(--ink)", letterSpacing: "0.04em", lineHeight: 1 }}>FITTRACKR</h1>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: paused ? "var(--ink3)" : "var(--ink)", letterSpacing: "0.06em", animation: paused && workoutStarted ? "pulse 1.5s infinite" : "none" }}>
              {paused && workoutStarted ? "⏸ " : ""}{formatTime(totalSeconds)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {user?.photoURL && <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: 0, border: "2px solid var(--yellow)" }} alt="" />}
            {workoutStarted && (
              <button onClick={togglePause} style={{ ...btnStyle(paused ? "active" : "ghost"), padding: "8px 14px" }}>
                {paused ? "▶ Resume" : "⏸ Pause"}
              </button>
            )}
          </div>
        </div>
      </div>

      <DeloadBanner uid={uid} />
      <div style={{ padding: "14px 14px 0" }}>

        {/* ── Session Details ── */}
        <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "visible", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
            <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Session Details</span>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Date</label>
                <FocusInput type="date" value={workout.date} onChange={e => setWorkout(w => ({ ...w, date: e.target.value }))} style={{ colorScheme: "light" }} />
              </div>
              <div>
                <label style={labelStyle}>Body Weight (lb)</label>
                <FocusInput type="number" inputMode="decimal" placeholder="e.g. 185" value={workout.bodyWeight} onChange={e => setWorkout(w => ({ ...w, bodyWeight: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Location</label>
                <ComboBox value={workout.location} onChange={val => setWorkout(w => ({ ...w, location: val }))} onCommit={val => onAddToLibrary("locations", val)} options={library.locations || []} placeholder="Gym, Home…" />
              </div>
              <div>
                <label style={labelStyle}>Workout Type</label>
                <ComboBox value={workout.workoutType} onChange={val => setWorkout(w => ({ ...w, workoutType: val }))} onCommit={val => onAddToLibrary("workoutTypes", val)} options={library.workoutTypes || DEFAULT_WORKOUT_TYPES} placeholder="Type…" />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Exercise Group</label>
              <ComboBox value={workout.exerciseGroup} onChange={val => setWorkout(w => ({ ...w, exerciseGroup: val }))} onCommit={val => onAddToLibrary("exerciseGroups", val)} options={library.exerciseGroups || ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"]} placeholder="Group…" />
            </div>
          </div>
        </div>

        {/* Template selector — shown below session details until dismissed or loaded */}
        {!templateSelectorDismissed && exercises.length === 0 && (
          <TemplateSelector
            templates={templates}
            onSelect={loadTemplate}
            onSkip={() => setTemplateSelectorDismissed(true)}
            onDelete={async t => {
              try { await deleteDoc(doc(db, "users", uid, "templates", t.id)); } catch (e) { console.error(e); }
            }}
          />
        )}

        <div
          onTouchMove={dragReorder.handleHandleTouchMove}
          onTouchEnd={dragReorder.handleHandleTouchEnd}
          onTouchCancel={dragReorder.handleHandleTouchEnd}
          style={{ touchAction: dragReorder.dragMode ? "none" : "auto", userSelect: dragReorder.dragMode ? "none" : "auto" }}
        >
          {dragReorder.dragMode && (
            <div style={{ textAlign: "center", fontSize: 11, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.1em", marginBottom: 8, textTransform: "uppercase" }}>
              Hold &amp; drag to reorder
            </div>
          )}
          {(() => {
            // Build superset label map: supersetId -> letter (A, B, C...)
            const ssLabels = {};
            let ssCounter = 0;
            exercises.forEach(e => {
              if (e.supersetId && !ssLabels[e.supersetId]) {
                ssLabels[e.supersetId] = String.fromCharCode(65 + ssCounter++);
              }
            });
            return exercises.map((ex, i) => {
            const isDragged = dragReorder.dragIndex === i;
            const isOver = dragReorder.overIndex === i && dragReorder.dragIndex !== null && !isDragged;
            const insertAbove = isOver && dragReorder.dragIndex > i;
            const insertBelow = isOver && dragReorder.dragIndex < i;
            // Superset grouping context
            const ssId = ex.supersetId;
            const ssLabel = ssId ? ssLabels[ssId] : null;
            const activeEx = activeExerciseIndex !== null ? exercises[activeExerciseIndex] : null;
            const inActiveSuperset = !!ssId && !!activeEx && activeEx.supersetId === ssId;
            const isFirstInSS = ssId && exercises.findIndex(e => e.supersetId === ssId) === i;
            const isLastInSS = ssId && [...exercises].reverse().findIndex(e => e.supersetId === ssId) === (exercises.length - 1 - i);
            return (
              <div key={ex.id} ref={el => dragReorder.setCardRef(i, el)} className="exercise-card-container">
                {/* Insertion line above */}
                {dragReorder.dragMode && (
                  <div style={{
                    height: insertAbove ? 3 : 0,
                    background: "var(--orange)",
                    borderRadius: 2,
                    margin: insertAbove ? "4px 0" : 0,
                    transition: "height 0.1s ease, margin 0.1s ease",
                    boxShadow: insertAbove ? "0 0 8px rgba(240,200,0,0.6)" : "none",
                  }} />
                )}
                {isFirstInSS && !dragReorder.dragMode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, paddingLeft: 4 }}>
                    <div style={{ fontFamily: "var(--font-label)", fontSize: 10, letterSpacing: "0.12em", color: "var(--orange)", fontWeight: 700, textTransform: "uppercase" }}>
                      🔗 Superset {ssLabel}
                    </div>
                    <div style={{ flex: 1, height: 1, background: "var(--orange2)" }} />
                  </div>
                )}
                <div style={ssId && !dragReorder.dragMode ? {
                  borderLeft: "3px solid var(--yellow)",
                  paddingLeft: 4,
                  marginBottom: isLastInSS ? 8 : 0,
                } : {}}>
                <ExerciseCard exercise={ex} index={i}
                  onChange={val => updateExercise(ex.id, val)} onRemove={() => removeExercise(ex.id)}
                  uid={uid} library={library} onAddToLibrary={onAddToLibrary}
                  isActive={activeExerciseIndex === i || inActiveSuperset}
                  paused={paused} activeElapsedRef={activeElapsedRef}
                  onInteract={ex.supersetId ? undefined : () => setActiveRestKeys({})}
                  onSetActive={() => setActiveExerciseIndex(i)}
                  restPrefs={restPrefs} onRestPrefChange={onRestPrefChange}
                  activeRestKeys={activeRestKeys} onSetRestActive={ex.supersetId ? addRestKey : key => setActiveRestKeys({[key]: true})} onClearRestKey={removeRestKey}
                  onDragHandleTouchStart={e => dragReorder.handleHandleTouchStart(i, e)}
                  onDragHandleMouseDown={e => dragReorder.handleHandleMouseDown(i, e)}
                  dragMode={dragReorder.dragMode}
                  isDragged={isDragged}
                  onToggleSuperset={dragReorder.dragMode ? undefined : () => toggleSuperset(ex.id)}
                  onFocusNextExercise={() => {
                    setTimeout(() => {
                      const allExerciseCards = document.querySelectorAll('.exercise-card-container');
                      const nextCard = allExerciseCards[i + 1];
                      if (nextCard) {
                        const firstReps = nextCard.querySelector('.set-row-reps');
                        if (firstReps) { firstReps.focus(); firstReps.select(); }
                      }
                    }, 150);
                  }}
/>
                </div>
                {/* Insertion line below */}
                {dragReorder.dragMode && (
                  <div style={{
                    height: insertBelow ? 3 : 0,
                    background: "var(--orange)",
                    borderRadius: 2,
                    margin: insertBelow ? "4px 0" : 0,
                    transition: "height 0.1s ease, margin 0.1s ease",
                    boxShadow: insertBelow ? "0 0 8px rgba(240,200,0,0.6)" : "none",
                  }} />
                )}
              </div>
            );
          });
          })()}
        </div>

        <button onClick={addExercise} disabled={!metaComplete} style={{ ...btnStyle("primary"), width: "100%", padding: "14px", fontSize: 16, opacity: metaComplete ? 1 : 0.45, boxShadow: metaComplete ? "0 3px 0 var(--ink)" : "none" }}>
          {metaComplete ? "+ Add Exercise" : `Missing: ${metaMissing.join(", ")}`}
        </button>

        {exercises.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => setConfirmCancel(true)}
              style={{ ...btnStyle("ghost"), flex: 1, padding: "14px", fontSize: 16, color: "var(--ink3)", borderColor: "var(--cream3)" }}>
              Cancel
            </button>
            <button onClick={() => setConfirmEnd(true)}
              style={{ ...btnStyle("ghost"), flex: 2, padding: "14px", fontSize: 16, color: "var(--red)", borderColor: "var(--red)" }}>
              End Workout
            </button>
          </div>
        )}
      </div>


      {/* ── Confirm Cancel Modal ── */}
      {confirmCancel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 24 }}>
          <div className="fade-in" style={{ background: "var(--card)", borderRadius: 4, overflow: "hidden", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <StripeBar height={5} />
            <div style={{ padding: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: "0.04em", marginBottom: 8, color: "var(--ink)" }}>CANCEL WORKOUT?</h2>
              <p style={{ color: "var(--ink3)", fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
                All progress will be lost. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmCancel(false)}
                  style={{ ...btnStyle("ghost"), flex: 1, padding: "12px" }}>Keep Going</button>
                <button onClick={() => { clearWorkoutDraft(); onEnd(); }}
                  style={{ ...btnStyle("primary"), flex: 1, padding: "12px", background: "var(--red)", boxShadow: "0 2px 0 #7a1010" }}>
                  Yes, Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm End Modal ── */}
      {confirmEnd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 24 }}>
          <div className="fade-in" style={{ background: "var(--card)", borderRadius: 4, overflow: "hidden", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <StripeBar height={5} />
            <div style={{ padding: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: "0.04em", marginBottom: 4, color: "var(--ink)" }}>END WORKOUT?</h2>
              <p style={{ color: "var(--ink3)", fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>Save your session.</p>

              {/* Save as template */}
              <div style={{ marginBottom: 24, padding: 14, background: "var(--cream)", borderRadius: 4, border: "1.5px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: saveAsTemplate ? 12 : 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>Save as Template?</label>
                  <div onClick={() => setSaveAsTemplate(p => !p)} style={{ width: 44, height: 24, borderRadius: 12, background: saveAsTemplate ? "var(--yellow)" : "var(--cream3)", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 2, left: saveAsTemplate ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "var(--card)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
                  </div>
                </div>
                {saveAsTemplate && (
                  <input
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    onFocus={() => setTemplateNameFocused(true)}
                    onBlur={() => setTemplateNameFocused(false)}
                    placeholder="Template name (e.g. Push Day A)"
                    style={{ ...inputStyle, fontSize: 15, ...(templateNameFocused ? inputFocusStyle : {}) }}
                  />
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmEnd(false)} style={{ ...btnStyle("ghost"), flex: 1, padding: "12px" }}>Keep Going</button>
                <button onClick={handleEndWorkout} disabled={saving || (saveAsTemplate && !templateName.trim())}
                  style={{ ...btnStyle("danger"), flex: 1, padding: "12px", boxShadow: "0 2px 0 #7a1010", opacity: (saving || (saveAsTemplate && !templateName.trim())) ? 0.5 : 1 }}>
                  {saving ? "Saving…" : "End Session"}
                </button>
              </div>
              <button onClick={() => { clearWorkoutDraft(); onEnd(); }}
                style={{ ...btnStyle("ghost"), width: "100%", marginTop: 8, padding: "10px", fontSize: 13, color: "var(--ink4)", borderColor: "var(--cream3)" }}>
                Discard Workout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Conflict Modal ── */}
      {showTemplateConflict && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 24 }}>
          <div className="fade-in" style={{ background: "var(--card)", borderRadius: 4, overflow: "hidden", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <StripeBar height={5} />
            <div style={{ padding: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: "0.04em", marginBottom: 8, color: "var(--ink)" }}>UPDATE TEMPLATE?</h2>
              <p style={{ color: "var(--ink3)", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
                You started from <strong>"{templateName}"</strong>. Do you want to overwrite it with today's sets, or save a new template?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => saveTemplateAndEnd(true)} style={{ ...btnStyle("primary"), width: "100%", padding: "12px", boxShadow: "0 2px 0 var(--red)" }}>
                  Overwrite "{templateName}"
                </button>
                <button onClick={() => saveTemplateAndEnd(false)} style={{ ...btnStyle("ghost"), width: "100%", padding: "12px" }}>
                  Save as New Template
                </button>
                <button onClick={() => { setShowTemplateConflict(false); endWorkout(); }} style={{ ...btnStyle("ghost"), width: "100%", padding: "12px", color: "var(--ink3)" }}>
                  Don't Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History Screen ────────────────────────────────────────────────────────────

// ── Edit Workout Modal ────────────────────────────────────────────────────────
function EditWorkoutModal({ uid, workout, exercises: initialExercises, onClose, onSaved }) {
  const [exercises, setExercises] = useState(
    initialExercises.map(ex => ({ ...ex, sets: (ex.sets || []).map(s => ({ ...s })) }))
  );
  const [saving, setSaving] = useState(false);

  function updateSet(exIdx, setIdx, key, val) {
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: ex.sets.map((s, j) => j !== setIdx ? s : { ...s, [key]: val })
    }));
  }
  function addSet(exIdx) {
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: [...ex.sets, { reps: "", weight: "", rir: "" }]
    }));
  }
  function removeSet(exIdx, setIdx) {
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: ex.sets.filter((_, j) => j !== setIdx)
    }));
  }
  const showsPartials = ex => ex.showPartials === true ||
    (ex.showPartials !== false && anySetHasPartials(ex.sets));
  function togglePartials(exIdx) {
    setExercises(prev => prev.map((ex, i) => {
      if (i !== exIdx) return ex;
      if (!showsPartials(ex)) return { ...ex, showPartials: true };
      return { ...ex, showPartials: false, sets: ex.sets.map(({ partials, ...s }) => s) };
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (const ex of exercises) {
        const cleanSets = ex.sets.filter(s => s.reps || s.weight || s.partials || s.duration || s.distance)
          .map(cleanSetForSave);
        const { primaryGroup: pg, primarySets: ps, secondarySets: ss } = computeFractionalSets(ex.name, ex.muscleGroup, cleanSets);
        await setDoc(doc(db, "users", uid, "workouts", workout.id, "exercises", ex.id),
          { name: ex.name, muscleGroup: ex.muscleGroup || null, order: ex.order || 0, sets: cleanSets,
            primaryGroup: pg, primarySets: ps, secondarySets: ss, supersetId: ex.supersetId || null },
          { merge: true }
        );
      }
      await updateExerciseStats(uid, exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets.filter(s => s.reps || s.weight).map(cleanSetForSave),
      })));
      onSaved();
      onClose();
    } catch (e) { console.error(e); alert("Error saving"); }
    setSaving(false);
  }

  const isCardio = ex => ex.muscleGroup === "Cardio";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 400, display: "flex", alignItems: "flex-end" }}>
      <div className="fade-in" style={{ width: "100%", maxHeight: "92vh", background: "var(--cream)", borderRadius: "12px 12px 0 0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <StripeBar height={5} />
        {/* Header */}
        <div style={{ background: "var(--card)", borderBottom: "1.5px solid var(--border)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ ...sectionLabelStyle, fontSize: 10, color: "var(--ink3)" }}>Editing</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1 }}>{workout.date}</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ ...btnStyle("ghost"), padding: "8px 14px" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ ...btnStyle("primary"), padding: "8px 14px", boxShadow: "0 2px 0 var(--red)" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {/* Scrollable exercises */}
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 16px 32px" }}>
          {exercises.map((ex, exIdx) => (
            <div key={ex.id} style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, padding: 14, marginBottom: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--orange)", letterSpacing: "0.04em", marginBottom: 10 }}>
                {ex.name.toUpperCase()}
                {ex.muscleGroup && <span style={{ fontFamily: "var(--font-label)", fontSize: 11, color: "var(--ink4)", marginLeft: 8, letterSpacing: "0.08em" }}>{ex.muscleGroup}</span>}
              </div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: isCardio(ex) ? "22px 1fr 1fr 28px" : (showsPartials(ex) ? SET_GRID_PARTIALS : SET_GRID), gap: 5, marginBottom: 4 }}>
                <div />
                {isCardio(ex) ? (
                  <><div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Duration</div>
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Dist (mi)</div></>
                ) : (
                  <><div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Reps</div>
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Weight</div>
                  {showsPartials(ex) && <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0, color: "var(--orange)" }}>Part</div>}
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>RIR</div></>
                )}
                <div />
              </div>
              {/* Sets */}
              {ex.sets.map((set, setIdx) => (
                <div key={setIdx} style={{ display: "grid", gridTemplateColumns: isCardio(ex) ? "22px 1fr 1fr 28px" : (showsPartials(ex) ? SET_GRID_PARTIALS : SET_GRID), gap: 5, marginBottom: 5, alignItems: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--ink3)", textAlign: "center" }}>{setIdx + 1}</div>
                  {isCardio(ex) ? (
                    <>
                      <input type="text" value={set.duration || ""} onChange={e => updateSet(exIdx, setIdx, "duration", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="mm:ss" />
                      <input type="number" value={set.distance || ""} onChange={e => updateSet(exIdx, setIdx, "distance", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="mi" />
                    </>
                  ) : (
                    <>
                      <input type="number" value={set.reps || ""} onChange={e => updateSet(exIdx, setIdx, "reps", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="—" />
                      <input type="number" value={set.weight || ""} onChange={e => updateSet(exIdx, setIdx, "weight", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="—" />
                      {showsPartials(ex) && (
                        <input type="number" value={set.partials || ""} onChange={e => updateSet(exIdx, setIdx, "partials", e.target.value)}
                          style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="—" min={0} />
                      )}
                      <input type="number" value={set.rir !== undefined && set.rir !== null ? set.rir : ""} onChange={e => updateSet(exIdx, setIdx, "rir", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="—" min={0} max={10} />
                    </>
                  )}
                  <button onClick={() => removeSet(exIdx, setIdx)}
                    style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button onClick={() => addSet(exIdx)}
                  style={{ ...btnStyle("ghost"), flex: 1, fontSize: 12, color: "var(--orange)", borderColor: "var(--orange2)", borderStyle: "dashed" }}>+ Add Set</button>
                {!isCardio(ex) && (
                  <button onClick={() => togglePartials(exIdx)}
                    style={{ ...btnStyle("ghost"), flexShrink: 0, fontSize: 12, padding: "8px 10px", whiteSpace: "nowrap",
                      color: showsPartials(ex) ? "var(--orange)" : "var(--ink3)",
                      borderColor: showsPartials(ex) ? "var(--orange2)" : "var(--border)",
                      borderStyle: showsPartials(ex) ? "solid" : "dashed" }}>
                    {showsPartials(ex) ? "− Partials" : "+ Partials"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── Deload Detection Banner ───────────────────────────────────────────────────
function useDeloadSignal(uid) {
  const [signal, setSignal] = useState(null); // null | { score, level, dismissed }
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!uid) return;
    async function check() {
      try {
        // Fetch workouts within last 14 days (up to 20)
        const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
        const cutoff14 = new Date();
        cutoff14.setDate(cutoff14.getDate() - 14);
        const cutoff14Str = cutoff14.toISOString().slice(0, 10);
        const docs = wSnap.docs.slice(0, 20).filter(d => (d.data().date || '') >= cutoff14Str);

        // Check if we have any recent workouts
        if (!docs.length) return;

        // Build workout rows with hiPct computed from exercises
        const rows = await Promise.all(docs.map(async wDoc => {
          const w = wDoc.data();
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          let totalVol = 0, hiVol = 0;
          for (const eDoc of eSnap.docs) {
            const { totalVol: tv, hiVol: hv } = computeSetVolumes(eDoc.data().sets);
            totalVol += tv; hiVol += hv;
          }
          return {
            date: w.date ?? null,
            sleepQuality: w.sleepQuality ?? null,
            energyLevel: w.energyLevel ?? null,
            postRating: w.postRating ?? null,
            hiPct: totalVol > 0 ? (hiVol / totalVol) * 100 : null,
          };
        }));

        const result = computeDeloadScore(rows);
        if (!result) return;

        // Check suggestion cap: read from localStorage
        const capKey = "fittrackr-deload-suggestions";
        let suggestions = [];
        try { suggestions = JSON.parse(localStorage.getItem(capKey) || "[]"); } catch {}
        const twoWeeksAgo = Date.now() - 14 * 86400000;
        suggestions = suggestions.filter(t => t > twoWeeksAgo);

        const level = result.score >= 0.60 ? "red" : result.score >= 0.40 ? "yellow" : null;
        if (!level) return;

        // Cap at 3 suggestions per 14 days
        if (suggestions.length >= 3) return;

        // Record this suggestion
        suggestions.push(Date.now());
        localStorage.setItem(capKey, JSON.stringify(suggestions));

        setSignal({ score: result.score, level, result });
      } catch (e) { console.error("Deload check error", e); }
      setChecked(true);
    }
    check();
  }, [uid]);

  return { signal, dismiss: () => setSignal(null) };
}

function DeloadBanner({ uid }) {
  const { signal, dismiss } = useDeloadSignal(uid);
  if (!signal) return null;
  const isRed = signal.level === "red";
  const bg = isRed ? "rgba(192,37,26,0.08)" : "rgba(240,200,0,0.10)";
  const border = isRed ? "var(--red)" : "var(--orange)";
  const icon = isRed ? "🔴" : "🟡";
  const headline = isRed ? "DELOAD WEEK RECOMMENDED" : "CONSIDER A LIGHTER WEEK";
  const body = isRed
    ? "Your recent sessions are showing signs of accumulated fatigue. A deload week will help you recover and come back stronger."
    : "Your recovery signals have been trending downward. A lighter week soon may be worth considering.";
  const r = signal.result;
  return (
    <div className="fade-in" style={{ margin: "12px 14px 0", background: bg, border: `1.5px solid ${border}`, borderRadius: 4, padding: "14px 16px", position: "relative" }}>
      <button onClick={dismiss} style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--ink4)", lineHeight: 1 }}>×</button>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.08em", color: isRed ? "var(--red)" : "var(--orange)", marginBottom: 6 }}>{icon} {headline}</div>
      <div style={{ fontSize: 13, color: "var(--ink3)", lineHeight: 1.5, marginBottom: 12 }}>{body}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Sleep", score: r.sleepScore },
          { label: "Energy", score: r.energyScore },
          { label: "Session", score: r.sessionScore },
          { label: "Hi%", score: r.hiPctScore },
        ].map(({ label, score }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--cream3)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(score * 100)}%`, height: "100%", background: score >= 0.6 ? "var(--red)" : score >= 0.4 ? "var(--orange)" : "var(--green)", borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 9, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.08em" }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Training Readiness Card ───────────────────────────────────────────────────
function TrainingReadinessCard({ uid }) {
  const [readiness, setReadiness] = useState(null); // null = loading
  const [insufficient, setInsufficient] = useState(false);

  useEffect(() => {
    if (!uid) return;
    async function compute() {
      try {
        const wSnap = await getDocsFromServer(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
        // Use all workouts within last 14 days (up to 20)
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const allDocs = wSnap.docs.slice(0, 20);
        const docs = allDocs.filter(d => (d.data().date || '') >= cutoffStr);
        if (!docs.length) { setInsufficient(true); return; }

        const rows = await Promise.all(docs.map(async wDoc => {
          const w = wDoc.data();
          const eSnap = await getDocsFromServer(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          let totalVol = 0, hiVol = 0;
          for (const eDoc of eSnap.docs) {
            const { totalVol: tv, hiVol: hv } = computeSetVolumes(eDoc.data().sets);
            totalVol += tv; hiVol += hv;
          }
          return {
            date: w.date ?? null,
            sleepQuality: w.sleepQuality ?? null,
            energyLevel: w.energyLevel ?? null,
            postRating: w.postRating ?? null,
            hiPct: totalVol > 0 ? (hiVol / totalVol) * 100 : null,
          };
        }));

        const result = computeDeloadScore(rows);
        if (!result) { setInsufficient(true); return; }
        const score = Math.round((1 - result.score) * 100);
        setReadiness({ score, result });
      } catch (e) { console.error("Readiness compute error", e); setInsufficient(true); }
    }
    compute();
  }, [uid]);

  function getStatus(score) {
    if (score >= 75) return { label: "Good to Go!", color: "var(--green)",  light: "🟢" };
    if (score >= 50) return { label: "Caution",     color: "var(--orange)", light: "🟡" };
    return                  { label: "Deload?",     color: "var(--red)",    light: "🔴" };
  }

  const isLoading = readiness === null && !insufficient;

  return (
    <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12 }}>
      <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
        <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Training Readiness</span>
      </div>
      <div style={{ padding: "16px 16px 18px" }}>
        {isLoading && (
          <div style={{ fontSize: 13, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.08em", animation: "pulse 1.5s infinite" }}>CALCULATING…</div>
        )}
        {insufficient && (
          <div style={{ fontSize: 13, color: "var(--ink4)", lineHeight: 1.5 }}>
            Not enough data yet. Log at least 3 sessions with sleep quality, energy level, and session rating to see your training readiness.
          </div>
        )}
        {readiness && (() => {
          const { score, result } = readiness;
          const { label, color, light } = getStatus(score);
          return (
            <>
              {/* Traffic light + score + label + trend */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <span style={{ fontSize: 48, lineHeight: 1 }}>{light}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color, letterSpacing: "0.04em", lineHeight: 1 }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--ink3)", letterSpacing: "0.04em", marginTop: 2 }}>{score} / 100</div>
                </div>
                {result.slopePenalty > 0 && (
                  <div style={{ textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--orange)", lineHeight: 1 }}>↘</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--orange)", letterSpacing: "0.04em", marginTop: 2 }}>Declining</div>
                  </div>
                )}
              </div>

              {/* Bar */}
              <div style={{ height: 8, background: "var(--cream3)", borderRadius: 4, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 4, transition: "width 0.8s ease" }} />
              </div>

              {/* Signal breakdown */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                {[
                  { label: "Sleep",   score: result.sleepScore,   invert: true },
                  { label: "Energy",  score: result.energyScore,  invert: true },
                  { label: "Session", score: result.sessionScore, invert: true },
                  { label: "Hi%",     score: result.hiPctScore,   invert: true },
                ].map(({ label: lbl, score: sig }) => {
                  const readinessSig = 1 - sig; // invert: low fatigue = high readiness
                  const sigColor = readinessSig >= 0.6 ? "var(--green)" : readinessSig >= 0.4 ? "var(--orange)" : "var(--red)";
                  return (
                    <div key={lbl} style={{ textAlign: "center" }}>
                      <div style={{ height: 4, background: "var(--cream3)", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
                        <div style={{ height: "100%", width: `${Math.round(readinessSig * 100)}%`, background: sigColor, borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.08em" }}>{lbl}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.05em" }}>
                Based on {result.count} session{result.count !== 1 ? "s" : ""} in the last 14 days
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}


// ── Bug Report Button ─────────────────────────────────────────────────────────
function BugReportButton({ uid, currentTab = "app" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      // Save to Firestore
      await addDoc(collection(db, "users", uid, "bugReports"), {
        text: text.trim(),
        createdAt: serverTimestamp(),
        appVersion: APP_VERSION,
        userAgent: navigator.userAgent,
        tab: currentTab,
      });
      setText("");
      setDone(true);
      setTimeout(() => { setDone(false); setOpen(false); }, 2000);
    } catch (e) {
      console.error("Bug report error", e);
    }
    setSubmitting(false);
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setDone(false); }}
        style={{
          position: "fixed", bottom: 70, right: 14, zIndex: 150,
          width: 38, height: 38, borderRadius: "50%",
          background: "var(--card)", border: "1.5px solid var(--border)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          cursor: "pointer", fontSize: 18, display: "flex",
          alignItems: "center", justifyContent: "center", padding: 0,
        }}
        title="Report a bug">🐛</button>

      {open && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20
        }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: "var(--card)", borderRadius: 4, width: "100%", maxWidth: 360, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.24)" }}>
            <StripeBar height={5} />
            <div style={{ padding: 20 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "0.06em", color: "var(--ink)", marginBottom: 4 }}>REPORT A BUG</div>
              <div style={{ fontSize: 12, color: "var(--ink4)", marginBottom: 14, lineHeight: 1.5 }}>
                Saved to Firestore + opens a GitHub issue in your browser.
              </div>
              {done ? (
                <div style={{ textAlign: "center", fontSize: 15, color: "var(--green)", padding: "16px 0", fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
                  ✓ Report submitted
                </div>
              ) : (
                <>
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Describe what happened and what you expected…"
                    rows={5}
                    style={{ ...inputStyle, width: "100%", fontSize: 14, padding: "10px 12px", resize: "none", marginBottom: 12, fontFamily: "inherit", lineHeight: 1.5 }}
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setOpen(false)}
                      style={{ ...btnStyle("ghost"), flex: 1, padding: "11px" }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={!text.trim() || submitting}
                      style={{ ...btnStyle("primary"), flex: 2, padding: "11px", boxShadow: "0 2px 0 var(--red)", opacity: !text.trim() || submitting ? 0.5 : 1 }}>
                      {submitting ? "Submitting…" : "Submit Bug Report"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


// ── Bug Reports Viewer (Profile screen) ──────────────────────────────────────
function BugReportsViewer({ uid }) {
  const [reports, setReports] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || !uid) return;
    getDocs(query(collection(db, "users", uid, "bugReports"), orderBy("createdAt", "desc")))
      .then(snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => setReports([]));
  }, [expanded, uid]);

  async function deleteReport(id) {
    await deleteDoc(doc(db, "users", uid, "bugReports", id));
    setReports(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginTop: 12 }}>
      <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Bug Reports</span>
        </div>
        <span style={{ color: "var(--orange)", fontSize: 14 }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: 14 }}>
          {reports === null && (
            <div style={{ fontSize: 13, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>Loading…</div>
          )}
          {reports?.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--ink4)" }}>No bug reports yet.</div>
          )}
          {reports?.map(r => (
            <div key={r.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--cream3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.06em", marginBottom: 4 }}>
                  {r.createdAt?.toDate?.()?.toLocaleDateString() ?? "—"}
                </div>
                <button onClick={() => deleteReport(r.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--ink4)", padding: 0, lineHeight: 1 }}>🗑</button>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{r.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryScreen({ uid }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [exercises, setExercises] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editWorkout, setEditWorkout] = useState(null); // { workout, exercises }

  useEffect(() => {
    const q = query(collection(db, "users", uid, "workouts"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, snap => { setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
    return unsub;
  }, [uid]);

  async function loadExercises(wid) {
    if (exercises[wid]) { setExpanded(expanded === wid ? null : wid); return; }
    const snap = await getDocs(collection(db, "users", uid, "workouts", wid, "exercises"));
    setExercises(prev => ({ ...prev, [wid]: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.order - b.order) }));
    setExpanded(wid);
  }

  async function confirmDelete(wid) {
    // Delete all exercises subcollection first, then the workout doc
    try {
      const exSnap = await getDocs(collection(db, "users", uid, "workouts", wid, "exercises"));
      await Promise.all(exSnap.docs.map(d => deleteDoc(doc(db, "users", uid, "workouts", wid, "exercises", d.id))));
      await deleteDoc(doc(db, "users", uid, "workouts", wid));
      setExercises(prev => { const n = { ...prev }; delete n[wid]; return n; });
      if (expanded === wid) setExpanded(null);
    } catch (err) { console.error("Delete failed:", err); }
    setDeleteConfirm(null);
  }

  async function openEdit(w) {
    let exs = exercises[w.id];
    if (!exs) {
      const snap = await getDocs(collection(db, "users", uid, "workouts", w.id, "exercises"));
      exs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
      setExercises(prev => ({ ...prev, [w.id]: exs }));
    }
    setEditWorkout({ workout: w, exercises: exs });
  }

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)" }}>Loading…</div>;

  function renderStars(rating) {
    if (!rating) return null;
    return <span style={{ fontSize: 14 }}>{"⭐".repeat(rating)}</span>;
  }

  function subtitle(w) {
    const parts = [resolveWorkoutType(w.workoutType), w.exerciseGroup, w.location].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
    if (w.importedFrom) return `Imported from ${w.importedFrom}`;
    return "";
  }

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Edit workout modal */}
      {editWorkout && (
        <EditWorkoutModal
          uid={uid}
          workout={editWorkout.workout}
          exercises={editWorkout.exercises}
          onClose={() => setEditWorkout(null)}
          onSaved={() => {
            // Invalidate cached exercises so they reload fresh
            setExercises(prev => { const n = { ...prev }; delete n[editWorkout.workout.id]; return n; });
            setEditWorkout(null);
          }}
        />
      )}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "var(--card)", borderRadius: 6, padding: 24, maxWidth: 320, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "0.04em", marginBottom: 8 }}>DELETE WORKOUT?</div>
            <div style={{ fontSize: 14, color: "var(--ink3)", marginBottom: 20, lineHeight: 1.5 }}>
              This will permanently delete this workout and all its exercises. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)}
                style={{ ...btnStyle("ghost"), flex: 1 }}>Cancel</button>
              <button onClick={() => confirmDelete(deleteConfirm)}
                style={{ ...btnStyle("primary"), flex: 1, background: "var(--red)", boxShadow: "0 2px 0 #a00" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {workouts.length === 0 && (
        <div style={{ textAlign: "center", padding: "64px 32px", color: "var(--ink3)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏋️</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--ink3)" }}>No workouts yet</div>
          <div style={{ fontSize: 14, marginTop: 8 }}>Tap + Log to get started</div>
        </div>
      )}
      {workouts.map(w => (
        <div key={w.id} style={{ background: "var(--card)", borderBottom: "1.5px solid var(--cream3)", overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div onClick={() => loadExercises(w.id)} style={{ flex: 1, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", letterSpacing: "0.03em", lineHeight: 1 }}>{w.date}</div>
                {renderStars(w.postRating)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "var(--font-label)" }}>
                {subtitle(w)}
              </div>
              {(w.sleepQuality || w.energyLevel || w.bodyWeight) && (
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  {w.bodyWeight && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)" }}>⚖ {w.bodyWeight}lb</span>}
                  {w.sleepQuality && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)" }}>😴 {w.sleepQuality}/5</span>}
                  {w.energyLevel && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)" }}>⚡ {w.energyLevel}/5</span>}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {w.totalSeconds > 0 && <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--ink3)" }}>{formatTime(w.totalSeconds)}</div>}
              <button onClick={() => openEdit(w)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: "4px 6px", color: "var(--ink4)", lineHeight: 1 }}>✏️</button>
              <button onClick={() => setDeleteConfirm(w.id)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: "4px 6px", color: "var(--ink4)", lineHeight: 1 }}>🗑</button>
              <div onClick={() => loadExercises(w.id)} style={{ color: "var(--orange)", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>{expanded === w.id ? "▲" : "▼"}</div>
            </div>
          </div>
          {expanded === w.id && <div style={{ height: 3, background: "var(--yellow)" }} />}
          {expanded === w.id && exercises[w.id] && (
            <div style={{ padding: "12px 16px", background: "var(--cream)" }}>
              {(() => {
                const renderExerciseBlock = (ex, key) => {
                  const isCardioEx = CARDIO_MUSCLE_GROUPS.has(ex.muscleGroup);
                  const hasDuration = (ex.sets || []).some(s => s.duration);
                  const showCardio = isCardioEx || hasDuration;
                  const cols = showCardio ? "24px 1fr 1fr" : "24px 1fr 1fr 1fr";
                  const headers = showCardio ? ["","Duration","Distance"] : ["","Reps","Weight","RIR"];
                  return (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                        {ex.order && <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--ink4)", letterSpacing: "0.04em", flexShrink: 0 }}>{ex.order}.</div>}
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--orange)", letterSpacing: "0.04em" }}>{ex.name.toUpperCase()}</div>
                        {ex.muscleGroup && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ex.muscleGroup}</span>}
                        {ex.durationSec > 0 && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-display)", letterSpacing: "0.06em" }}>⏱ {formatTime(ex.durationSec)}</span>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, marginBottom: 4 }}>
                        {headers.map((h, hi) => <div key={hi} style={{ ...labelStyle, textAlign: hi > 0 ? "center" : "left", marginBottom: 0 }}>{h}</div>)}
                      </div>
                      {(ex.sets || []).length === 0 && showCardio ? (
                        <div style={{ fontSize: 12, color: "var(--ink4)", fontStyle: "italic", padding: "4px 0" }}>No duration or distance recorded</div>
                      ) : (ex.sets || []).map((set, j) => (
                        <div key={j} style={{ display: "grid", gridTemplateColumns: cols, gap: 4, marginBottom: 4, padding: "4px 0", borderBottom: "1px solid var(--cream3)" }}>
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink3)" }}>{j + 1}</div>
                          {showCardio ? (
                            <>
                              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.duration || "—"}</div>
                              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.distance ? `${set.distance} mi` : "—"}</div>
                            </>
                          ) : (
                            <>
                              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{formatReps(set) || "—"}</div>
                              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.weight ? <>{set.weight}<span style={{ color: "var(--ink4)", fontSize: 11 }}>lb</span></> : "—"}</div>
                              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.rir !== "" && set.rir != null ? set.rir : "—"}</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                };

                // Group consecutive exercises sharing the same supersetId
                const groups = [];
                exercises[w.id].forEach(ex => {
                  if (ex.supersetId && groups.length > 0 && groups[groups.length - 1].supersetId === ex.supersetId) {
                    groups[groups.length - 1].items.push(ex);
                  } else {
                    groups.push({ supersetId: ex.supersetId || null, items: [ex] });
                  }
                });

                return groups.map((group, gi) => {
                  if (group.supersetId && group.items.length > 1) {
                    return (
                      <div key={gi} style={{ borderLeft: "3px solid var(--yellow)", paddingLeft: 10, marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontFamily: "var(--font-label)", color: "var(--ink4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>🔗 Superset</div>
                        {group.items.map((ex, i) => renderExerciseBlock(ex, `${gi}-${i}`))}
                      </div>
                    );
                  }
                  return group.items.map((ex, i) => renderExerciseBlock(ex, `${gi}-${i}`));
                });
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// ── Templates Screen ──────────────────────────────────────────────────────────
function TemplatesScreen({ uid, templates, onStartWorkout }) {
  const [expanded, setExpanded] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  async function confirmDelete(t) {
    try {
      await deleteDoc(doc(db, "users", uid, "templates", t.id));
    } catch (e) { console.error("Delete template failed:", e); }
    setDeleteConfirm(null);
    if (expanded === t.id) setExpanded(null);
  }

  if (templates.length === 0) return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--orange)", letterSpacing: "0.04em", marginBottom: 8 }}>NO TEMPLATES</div>
      <div style={{ fontSize: 14, color: "var(--ink3)", lineHeight: 1.6 }}>Save a template when ending a workout to see it here.</div>
    </div>
  );

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="fade-in" style={{ background: "var(--card)", borderRadius: 4, overflow: "hidden", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <StripeBar height={5} />
            <div style={{ padding: 24 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "0.04em", marginBottom: 8 }}>DELETE TEMPLATE?</div>
              <div style={{ fontSize: 14, color: "var(--ink3)", marginBottom: 20, lineHeight: 1.5 }}>
                "{deleteConfirm.name}" will be permanently deleted.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDeleteConfirm(null)} style={{ ...btnStyle("ghost"), flex: 1 }}>Cancel</button>
                <button onClick={() => confirmDelete(deleteConfirm)}
                  style={{ ...btnStyle("primary"), flex: 1, background: "var(--red)", boxShadow: "0 2px 0 #a00" }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {templates.map(t => (
        <div key={t.id} style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          {/* Header row */}
          <div style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1 }}>{t.name.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, fontFamily: "var(--font-label)", letterSpacing: "0.06em" }}>
                {t.exercises.length} exercise{t.exercises.length !== 1 ? "s" : ""}{t.workoutType ? ` · ${t.workoutType}` : ""}{t.exerciseGroup ? ` · ${t.exerciseGroup}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <button onClick={e => { e.stopPropagation(); setDeleteConfirm(t); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--ink4)", padding: "4px 6px", lineHeight: 1 }}>🗑</button>
              <span style={{ color: "var(--orange)", fontSize: 16, fontWeight: 700 }}>{expanded === t.id ? "▲" : "▼"}</span>
            </div>
          </div>

          {/* Expanded detail */}
          {expanded === t.id && (
            <>
              <div style={{ height: 3, background: "var(--yellow)" }} />
              <div style={{ padding: "12px 14px", background: "var(--cream)" }}>
                {t.exercises.map((ex, i) => (
                  <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < t.exercises.length - 1 ? "1px solid var(--cream3)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--orange)", letterSpacing: "0.04em" }}>{ex.name.toUpperCase()}</span>
                      {ex.muscleGroup && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", textTransform: "uppercase" }}>{ex.muscleGroup}</span>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
                      {["","Reps","Weight","RIR"].map((h, j) => (
                        <div key={j} style={{ ...labelStyle, textAlign: j > 0 ? "center" : "left", marginBottom: 0, fontSize: 10 }}>{h}</div>
                      ))}
                    </div>
                    {(ex.sets || []).map((s, j) => (
                      <div key={j} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, marginBottom: 3, padding: "3px 0", borderBottom: "1px solid var(--cream3)" }}>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "var(--ink3)" }}>{j + 1}</div>
                        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{formatReps(s)}</div>
                        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{s.weight}<span style={{ color: "var(--ink4)", fontSize: 10 }}>lb</span></div>
                        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{s.rir !== "" && s.rir != null ? s.rir : "—"}</div>
                      </div>
                    ))}
                  </div>
                ))}
                <button onClick={() => onStartWorkout(t)}
                  style={{ ...btnStyle("primary"), width: "100%", padding: "12px", marginTop: 8, boxShadow: "0 2px 0 var(--red)" }}>
                  Start Workout
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}


// ── Bug Report Button ─────────────────────────────────────────────────────────
// ── Lookup Screen ─────────────────────────────────────────────────────────────
function LookupScreen({ uid, library }) {
  const [muscleGroup, setMuscleGroup] = useState("All");
  const [exerciseName, setExerciseName] = useState("");
  const [results, setResults] = useState(null); // null = not searched yet
  const [loading, setLoading] = useState(false);

  // Build exercise list filtered by muscle group using the canonical library
  const filteredExercises = useMemo(() => {
    const all = EXERCISE_LIBRARY.map(e => e.name).sort();
    if (muscleGroup === "All") return all;
    return all.filter(name => {
      const m = MUSCLE_GROUP_MAPPINGS[name];
      return m?.primaryGroup === muscleGroup || (m?.secondaryGroups?.[muscleGroup] != null);
    });
  }, [muscleGroup]);

  // Auto-select first exercise when list changes
  const effectiveExercise = filteredExercises.includes(exerciseName) ? exerciseName : (filteredExercises[0] || "");

  async function search() {
    if (!effectiveExercise) return;
    setLoading(true);
    setResults(null);
    try {
      const wSnap = await getDocsFromServer(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
      const sessions = [];
      for (const wDoc of wSnap.docs) {
        if (sessions.length >= 10) break;
        const wData = wDoc.data();
        const eSnap = await getDocsFromServer(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
        for (const eDoc of eSnap.docs) {
          const ex = eDoc.data();
          if (ex.name !== effectiveExercise) continue;
          // Compute best e1RM for this session
          let bestE1RM = null;
          for (const set of (ex.sets || [])) {
            const reps = Number(set.reps);
            const weight = Number(set.weight);
            if (reps >= 3 && reps <= 12 && weight > 0) {
              const e1rm = weight * (1 + reps / 30);
              if (bestE1RM === null || e1rm > bestE1RM) bestE1RM = e1rm;
            }
          }
          sessions.push({
            date: wData.date,
            workoutType: wData.workoutType || null,
            sets: ex.sets || [],
            durationSec: ex.durationSec || null,
            bestE1RM: bestE1RM ? Math.round(bestE1RM) : null,
          });
          break; // one exercise match per workout
        }
      }
      setResults(sessions);
    } catch (e) { console.error(e); setResults([]); }
    setLoading(false);
  }

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12 }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Exercise Lookup</span>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Muscle Group</label>
            <select value={muscleGroup} onChange={e => setMuscleGroup(e.target.value)}
              style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
              <option value="All">All</option>
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Exercise</label>
            <select value={effectiveExercise} onChange={e => setExerciseName(e.target.value)}
              style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
              {filteredExercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
            </select>
          </div>
          <button onClick={search} disabled={loading || !effectiveExercise}
            style={{ ...btnStyle("primary"), width: "100%", padding: "11px", boxShadow: "0 2px 0 var(--red)" }}>
            {loading ? "Searching…" : "🔍 Search"}
          </button>
        </div>
      </div>

      {results !== null && results.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink3)", fontSize: 14 }}>
          No sessions found for {effectiveExercise}.
        </div>
      )}

      {(results || []).map((session, si) => (
        <div key={si} style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 10 }}>
          <div style={{ background: "var(--black)", padding: "7px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--yellow)", letterSpacing: "0.04em" }}>{session.date}</div>
              {session.workoutType && <span style={{ fontSize: 10, color: "var(--ink4)", fontFamily: "var(--font-label)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{session.workoutType}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {session.durationSec > 0 && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}>⏱ {formatTime(session.durationSec)}</span>}
              {session.bestE1RM && <span style={{ fontSize: 11, color: "var(--orange)", fontFamily: "var(--font-label)", letterSpacing: "0.04em" }}>e1RM: ~{session.bestE1RM}lb</span>}
            </div>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
              {["", "Reps", "Weight", "RIR"].map((h, i) => (
                <div key={i} style={{ ...labelStyle, textAlign: i > 0 ? "center" : "left", marginBottom: 0, fontSize: 10 }}>{h}</div>
              ))}
            </div>
            {session.sets.filter(s => s.reps || s.weight).map((set, j) => (
              <div key={j} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, padding: "4px 0", borderBottom: "1px solid var(--cream3)" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--ink3)" }}>{j + 1}</div>
                <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{formatReps(set) || "—"}</div>
                <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{set.weight ? <>{set.weight}<span style={{ color: "var(--ink4)", fontSize: 10 }}>lb</span></> : "—"}</div>
                <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{set.rir !== "" && set.rir != null ? set.rir : "—"}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BottomNav({ tab, setTab, onNewWorkout, logging }) {
  const items = [
    { id: "log",       icon: "➕", label: "Log" },
    { id: "history",   icon: "📅", label: "History" },
    { id: "lookup",    icon: "🔍", label: "Lookup" },
    { id: "templates", icon: "📋", label: "Templates" },
    { id: "analytics", icon: "📊", label: "Analytics" },
    { id: "profile",   icon: "👤", label: "Profile" },
  ];
  const workoutInProgress = logging && tab !== "log";
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--cream)", borderTop: "2.5px solid var(--ink)", zIndex: 100 }}>
      <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none" }}>
        {items.map(item => {
          const isActive = item.id === "log" ? (logging && tab === "log") : tab === item.id;
          const isLogBtn = item.id === "log";
          function handleClick() {
            if (isLogBtn) {
              if (logging) setTab("log");
              else onNewWorkout();
            } else {
              setTab(item.id);
            }
          }
          return (
            <button key={item.id} onClick={handleClick}
              style={{ position: "relative", flexShrink: 0, width: `${100 / items.length}%`, minWidth: 52, padding: "10px 0", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transition: "background 0.15s", background: isActive ? "var(--yellow)" : "transparent", borderRight: "1px solid var(--border)", color: isActive ? "var(--black)" : "var(--ink3)" }}>
              <span style={{ fontSize: 17 }}>{item.icon}</span>
              <span style={{ fontSize: 8, fontWeight: isActive ? 700 : 400, letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "var(--font-label)" }}>{item.label}</span>
              {isLogBtn && workoutInProgress && (
                <div style={{ position: "absolute", top: 6, right: "30%", width: 7, height: 7, borderRadius: "50%", background: "var(--orange)", animation: "pulse 1.5s infinite" }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileScreen({ user, onSeedLibrary, onImportStrong, volumeBackfilled }) {
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.body.classList.contains("dark"));
  const fileRef = useRef();

  function toggleDark() {
    const next = !darkMode;
    setDarkMode(next);
    document.body.classList.toggle("dark", next);
    localStorage.setItem("fittrackr-dark", next ? "1" : "0");
  }

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const wSnap = await getDocs(query(collection(db, "users", user.uid, "workouts"), orderBy("date", "desc")));
      let updated = 0, skipped = 0;
      for (const wDoc of wSnap.docs) {
        const eSnap = await getDocs(collection(db, "users", user.uid, "workouts", wDoc.id, "exercises"));
        for (const eDoc of eSnap.docs) {
          const ex = eDoc.data();
          // Only backfill if primarySets not yet written
          if (ex.primarySets != null) { skipped++; continue; }
          const { primaryGroup, primarySets, secondarySets } = computeFractionalSets(ex.name, ex.muscleGroup, ex.sets || []);
          await setDoc(doc(db, "users", user.uid, "workouts", wDoc.id, "exercises", eDoc.id),
            { primaryGroup, primarySets, secondarySets }, { merge: true });
          updated++;
        }
      }
      // Mark backfill complete on user meta
      await setDoc(doc(db, "users", user.uid, "meta", "library"),
        { volumeDataBackfilled: true }, { merge: true });
      setBackfillResult({ updated, skipped });
    } catch (e) {
      console.error("Backfill error", e);
      setBackfillResult({ error: e.message });
    }
    setBackfilling(false);
  }

  // Apply saved dark mode on mount
  useEffect(() => {
    const saved = localStorage.getItem("fittrackr-dark");
    if (saved === "1") { document.body.classList.add("dark"); setDarkMode(true); }
  }, []);

  async function handleSeed() {
    setSeeding(true);
    await onSeedLibrary();
    setSeeding(false);
    setSeeded(true);
  }

  function parseStrongCSV(text) {
    const lines = text.trim().split('\n');
    const rows = [];
    for (const line of lines) {
      let l = line.trim();
      if (!l) continue;
      l = l.replace(/,,\s*$/, '');
      if (l.startsWith('"') && l.endsWith('"')) l = l.slice(1, -1);
      const parts = l.split(';').map(p => p.replace(/""/g, '').replace(/^"|"$/g, '').trim());
      rows.push(parts);
    }
    return rows;
  }

  function rpeToRir(rpe) {
    if (!rpe || rpe.trim() === '') return '';
    const val = parseFloat(rpe);
    if (isNaN(val)) return '';
    return String(Math.max(0, Math.round(10 - val)));
  }

  function kgToLbs(kg) {
    if (!kg || kg.trim() === '') return '';
    const val = parseFloat(kg);
    if (isNaN(val) || val === 0) return '0';
    return (val * 2.20462).toFixed(1);
  }

  // Skip exercises that are purely cardio (no weight/reps)
  const CARDIO_EXERCISES = new Set([
    'Running','Running (Treadmill)','Walking','Backwards Walking','Cycling (Indoor)',
    'Rowing (Machine)','Stairmaster','Sled Push','Farmer Carry','Suitcase Carry',
    'Suitcase Marches','Barbell Overhead Marches','Dumbbell Overhead Marches',
    'Dumbbell Front Rack Marches',
  ]);

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const rows = parseStrongCSV(text);

      // Group rows by workout number
      const workoutMap = new Map();
      for (const row of rows.slice(1)) {
        if (row.length < 8) continue;
        // Columns: 0=Workout#, 1=Date, 2=WorkoutName, 3=Duration, 4=ExName, 5=SetOrder, 6=WeightKg, 7=Reps, 8=RPE
        const workoutNum = row[0];
        const dateStr    = row[1];
        const durationSec = row[3];
        const exerciseName = row[4]?.trim();
        const setOrder   = row[5];
        const weightKg   = row[6];
        const reps       = row[7]?.trim();
        const rpe        = row[8] || '';

        if (!workoutNum || !dateStr || !exerciseName) continue;

        // Skip cardio-only exercises
        if (CARDIO_EXERCISES.has(exerciseName)) continue;
        // Skip rows with no reps (pure distance/time cardio)
        if (!reps || reps === '0') continue;

        if (!workoutMap.has(workoutNum)) {
          workoutMap.set(workoutNum, {
            date: dateStr.split(' ')[0],
            durationSec: parseInt(durationSec) || 0,
            exercises: new Map(),
          });
        }

        const workout = workoutMap.get(workoutNum);
        if (!workout.exercises.has(exerciseName)) {
          workout.exercises.set(exerciseName, []);
        }

        workout.exercises.get(exerciseName).push({
          setOrder: parseInt(setOrder) || 1,
          weight: kgToLbs(weightKg),
          reps,
          rir: rpeToRir(rpe),
        });
      }

      // Write to Firebase
      let imported = 0, skipped = 0;
      for (const [, workout] of workoutMap) {
        if (workout.exercises.size === 0) { skipped++; continue; }
        try {
          const wRef = await addDoc(collection(db, 'users', user.uid, 'workouts'), {
            date: workout.date,
            location: '',
            workoutType: '',
            exerciseGroup: '',
            totalSeconds: workout.durationSec,
            importedFrom: 'Strong',
            createdAt: serverTimestamp(),
          });
          let order = 1;
          for (const [exName, sets] of workout.exercises) {
            const sortedSets = sets
              .sort((a, b) => a.setOrder - b.setOrder)
              .map(({ setOrder, ...s }) => s);
            // Look up muscle group from library
            const libEntry = EXERCISE_LIBRARY.find(
              e => e.name.toLowerCase() === exName.toLowerCase()
            );
            await addDoc(collection(db, 'users', user.uid, 'workouts', wRef.id, 'exercises'), {
              name: exName,
              muscleGroup: libEntry ? (libEntry.primaryGroup || libEntry.muscleGroup) : '',
              order: order++,
              sets: sortedSets,
            });
          }
          imported++;
        } catch (err) {
          console.error('Import error:', err);
          skipped++;
        }
      }
      setImportResult({ imported, skipped });
    } catch (err) {
      console.error(err);
      setImportResult({ error: err.message });
    }
    setImporting(false);
    e.target.value = '';
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Profile card */}
      <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Profile</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, paddingBottom: 16, borderBottom: "1.5px solid var(--cream3)" }}>
            {user?.photoURL && <img src={user.photoURL} style={{ width: 52, height: 52, borderRadius: 0, border: "2.5px solid var(--yellow)" }} alt="" />}
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: "0.04em", lineHeight: 1 }}>{user.displayName?.toUpperCase()}</div>
              <div style={{ color: "var(--ink3)", fontSize: 13, marginTop: 2 }}>{user.email}</div>
            </div>
          </div>
          <button onClick={() => signOut(auth)} style={{ ...btnStyle("ghost"), width: "100%", marginBottom: 10 }}>Sign Out</button>
          <button onClick={toggleDark}
            style={{ ...btnStyle("ghost"), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
          </button>
        </div>
      </div>

      {/* Exercise library */}
      <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Exercise Library</span>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 10, lineHeight: 1.5 }}>
            Load the full built-in exercise library (246 exercises with muscle groups). Your custom exercises won't be affected.
          </div>
          <button onClick={handleSeed} disabled={seeding || seeded}
            style={{ ...btnStyle(seeded ? "ghost" : "primary"), width: "100%", padding: "10px", opacity: seeded ? 0.6 : 1, boxShadow: seeded ? "none" : "0 2px 0 var(--red)" }}>
            {seeding ? "Loading…" : seeded ? "✓ Library Loaded" : "Load Exercise Library"}
          </button>
        </div>
      </div>

      {/* Volume Data Backfill */}
      {!volumeBackfilled && !backfillResult?.updated && (
        <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12 }}>
          <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
            <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Volume Data Backfill</span>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 10, lineHeight: 1.5 }}>
              Write primary and secondary set data to all existing workouts. One-time operation — this card disappears once complete.
            </div>
            <button onClick={handleBackfill} disabled={backfilling}
              style={{ ...btnStyle("primary"), width: "100%", padding: "10px", boxShadow: "0 2px 0 var(--red)" }}>
              {backfilling ? "Backfilling… (may take a moment)" : "Backfill Volume Data"}
            </button>
            {backfillResult?.error && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>Error: {backfillResult.error}</div>
            )}
          </div>
        </div>
      )}
      {backfillResult?.updated > 0 && (
        <div style={{ background: "var(--card)", border: "1.5px solid var(--green)", borderRadius: 4, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: "var(--green)" }}>
          ✓ Backfill complete — {backfillResult.updated} exercises updated, {backfillResult.skipped} already had data
        </div>
      )}

      {/* Strong import */}
      <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Import from Strong</span>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 6, lineHeight: 1.5 }}>
            Export your data from Strong (Profile → Settings → Export Data) and upload the CSV here.
          </div>
          <div style={{ fontSize: 12, color: "var(--ink4)", marginBottom: 12, lineHeight: 1.5 }}>
            Weights converted kg → lbs · RPE converted to RIR · Cardio skipped · Muscle groups auto-assigned
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange}
            style={{ display: "none" }} />
          <button onClick={() => fileRef.current.click()} disabled={importing}
            style={{ ...btnStyle("primary"), width: "100%", padding: "10px", boxShadow: "0 2px 0 var(--red)" }}>
            {importing ? "Importing…" : "Choose CSV File"}
          </button>
          {importing && (
            <div style={{ marginTop: 12, textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>
              <div style={{ animation: "pulse 1.5s infinite", fontFamily: "var(--font-display)", fontSize: 20, color: "var(--orange)", letterSpacing: "0.04em" }}>IMPORTING…</div>
              <div style={{ marginTop: 4 }}>This may take a minute for large files</div>
            </div>
          )}
          {importResult && !importResult.error && (
            <div style={{ marginTop: 12, padding: 12, background: "#e8f5ee", border: "1.5px solid var(--green)", borderRadius: 4 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--green)", letterSpacing: "0.04em" }}>IMPORT COMPLETE</div>
              <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>
                {importResult.imported} workouts imported · {importResult.skipped} skipped
              </div>
            </div>
          )}
          {importResult?.error && (
            <div style={{ marginTop: 12, padding: 12, background: "#ffeaea", border: "1.5px solid var(--red)", borderRadius: 4 }}>
              <div style={{ fontSize: 13, color: "var(--red)" }}>Import failed: {importResult.error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Bug Reports Viewer */}
      <BugReportsViewer uid={user.uid} />

    </div>
  );
}


// ── Analytics helpers ─────────────────────────────────────────────────────────

function analyticsWeekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function analyticsAddWeeks(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}
function analyticsFormatWeekLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function AnalyticsScreen({ uid }) {

  const [report, setReport]         = useState(null); // null = not yet run
  const [selectedReport, setSelectedReport] = useState("sets");
  const [running, setRunning]       = useState(false);
  const [allData, setAllData]       = useState(null); // loaded once, reused across reports
  const [allTimeData, setAllTimeData] = useState(null); // loaded once for time report
  const [rirData, setRirData]       = useState(null); // loaded once for RIR report
  const [muscleGroup, setMuscleGroup] = useState("All");
  const [range, setRange]           = useState("26");
  const [rirView, setRirView]       = useState("exercise"); // "exercise" | "ranked"
  const [rirExercise, setRirExercise] = useState("");
  const [expanded, setExpanded]     = useState(false);
  const REPORTS = [
    { id: "sets",    label: "Sets Per Week",    desc: "Total sets by muscle group per week — primary sets (orange) + secondary fractional credits (blue)" },
    { id: "volume",  label: "Volume Per Week",  desc: "Total volume with high-intensity portion (≥75% e1RM) stacked, plus hi% line — primary sets only" },
    { id: "time",    label: "Time Per Week",    desc: "Hours spent per week split between lifting (orange) and cardio (teal) — stacked bar chart" },
    { id: "rir",     label: "RIR Accuracy",     desc: "Compare reported vs. calculated RIR set by set — see where your effort perception diverges from your e1RM model" },
  ];

  // Load all exercise data — parallel fetching for speed
  async function loadData() {
    setRunning(true);
    try {
      const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "asc")));
      // Fetch all exercise subcollections in parallel
      const results = await Promise.all(
        wSnap.docs.map(async wDoc => {
          const wDate = wDoc.data().date;
          if (!wDate) return [];
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          const rows = [];
          for (const eDoc of eSnap.docs) {
            const ex = eDoc.data();
            if (!ex.muscleGroup) continue;
            const validSets = (ex.sets || []).filter(s => effectiveReps(s) > 0);
            if (!validSets.length) continue;

            const { hiVol: hiVolume } = computeSetVolumes(validSets);
            // Use pre-computed fractional data if available, fall back to raw count
            const primarySets = ex.primarySets != null ? ex.primarySets : validSets.length;
            const secondarySets = ex.secondarySets || {};
            rows.push({
              date: wDate,
              muscleGroup: ex.primaryGroup || ex.muscleGroup,
              sets: primarySets,
              secondarySets,
              volume: validSets.reduce((sum, s) => sum + effectiveReps(s) * (parseFloat(s.weight) || 0), 0),
              hiVolume,
            });
            // Also push secondary set credits as separate rows for the sets chart
            for (const [sg, credit] of Object.entries(secondarySets)) {
              rows.push({
                date: wDate,
                muscleGroup: sg,
                sets: 0,           // primary contribution is 0 for secondary rows
                secondarySets: {}, // avoid double-counting
                secondaryCredit: credit,
                volume: 0,
                hiVolume: 0,
                isSecondary: true,
              });
            }
          }
          return rows;
        })
      );
      const rows = results.flat();
      setAllData(rows);
      return rows;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // Load per-workout time data: one row per workout with cardio and non-cardio seconds
  async function loadTimeData() {
    setRunning(true);
    try {
      const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "asc")));
      const results = await Promise.all(
        wSnap.docs.map(async wDoc => {
          const wData = wDoc.data();
          if (!wData.date) return null;
          const totalSec = wData.totalSeconds || 0;
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          let cardioSec = 0;
          for (const eDoc of eSnap.docs) {
            const ex = eDoc.data();
            if (ex.muscleGroup === "Cardio" && ex.durationSec > 0) {
              cardioSec += ex.durationSec;
            }
          }
          const nonCardioSec = Math.max(0, totalSec - cardioSec);
          return { date: wData.date, cardioSec, nonCardioSec };
        })
      );
      const rows = results.filter(Boolean);
      setAllTimeData(rows);
      return rows;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async function loadRirData() {
    try {
      const statsSnap = await getDoc(doc(db, "users", uid, "meta", "exerciseStats"));
      const exStats = statsSnap.exists() ? statsSnap.data() : {};
      const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "asc")));
      const rows = [];
      await Promise.all(wSnap.docs.map(async wDoc => {
        const wDate = wDoc.data().date;
        if (!wDate) return;
        const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
        for (const eDoc of eSnap.docs) {
          const ex = eDoc.data();
          if (CARDIO_MUSCLE_GROUPS.has(ex.muscleGroup) || !ex.name) continue;
          const stat = exStats[ex.name];
          if (!stat?.bestE1RM) continue;
          for (const set of (ex.sets || [])) {
            const reps = Number(set.reps);
            const weight = Number(set.weight);
            if (!reps || !weight || reps < 3 || reps > 12) continue;
            const reportedRIR = (set.rir !== "" && set.rir != null) ? Number(set.rir) : null;
            if (reportedRIR === null) continue;
            const predictedMaxReps = (stat.bestE1RM / weight - 1) * 30;
            const calcRIR = Math.max(0, Math.min(10, Math.round(predictedMaxReps - reps)));
            rows.push({
              date: wDate, exerciseName: ex.name,
              weight, reps, reportedRIR, calcRIR,
              discrepancy: calcRIR - reportedRIR,
            });
          }
        }
      }));
      const result = { rows, exStats };
      setRirData(result);
      return result;
    } catch (e) { console.error(e); return { rows: [], exStats: {} }; }
  }

  async function runReport() {
    setRunning(true);
    try {
      if (selectedReport === "time") {
        let data = allTimeData;
        if (!data) data = await loadTimeData();
        setReport({ type: "time", data: data || [] });
      } else if (selectedReport === "rir") {
        let data = rirData;
        if (!data) data = await loadRirData();
        setReport({ type: "rir", data: data || { rows: [], exStats: {} } });
      } else {
        let data = allData;
        if (!data) data = await loadData();
        setReport({ type: selectedReport, data: data || [] });
      }
    } catch (e) { console.error(e); }
    setRunning(false);
  }

  const weekStart = analyticsWeekStart;
  const addWeeks = analyticsAddWeeks;
  const formatWeekLabel = analyticsFormatWeekLabel;

  const chartData = useMemo(() => {
    if (!report?.data) return [];
    if (report.type === "rir" || report.type === "time") return [];
    const isVolume = report.type === "volume";
    const filtered = muscleGroup === "All"
      ? report.data
      : report.data.filter(r => r.muscleGroup === muscleGroup);
    if (!filtered.length) return [];

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const thisWeek = weekStart(todayStr);
    let startWeek;
    if (range === "all") {
      startWeek = weekStart(filtered[0].date);
    } else {
      const d = new Date(today);
      d.setDate(d.getDate() - parseInt(range) * 7);
      startWeek = weekStart(d.toISOString().slice(0, 10));
    }

    const primaryMap = new Map();
    const secondaryMap = new Map();
    const hiMap = new Map();
    for (const row of filtered) {
      const ws = weekStart(row.date);
      if (ws < startWeek) continue;
      if (isVolume) {
        // Volume report: primary sets only
        primaryMap.set(ws, (primaryMap.get(ws) || 0) + (row.isSecondary ? 0 : row.volume));
        hiMap.set(ws, (hiMap.get(ws) || 0) + (row.isSecondary ? 0 : row.hiVolume || 0));
      } else {
        // Sets report: primary + secondary separately
        if (row.isSecondary) {
          secondaryMap.set(ws, Math.round(((secondaryMap.get(ws) || 0) + (row.secondaryCredit || 0)) * 10) / 10);
        } else {
          primaryMap.set(ws, (primaryMap.get(ws) || 0) + row.sets);
        }
      }
    }

    const weeks = [];
    let cur = startWeek;
    while (cur <= thisWeek) {
      const primary = primaryMap.get(cur) || 0;
      const secondary = isVolume ? 0 : (secondaryMap.get(cur) || 0);
      const entry = {
        week: cur,
        value: isVolume ? primary : primary + secondary,
        primary,
        secondary,
        label: formatWeekLabel(cur),
      };
      if (isVolume) entry.hi = hiMap.get(cur) || 0;
      weeks.push(entry);
      cur = addWeeks(cur, 1);
    }
    return weeks;
  }, [report, muscleGroup, range]);

  const availableGroups = useMemo(() => {
    if (!report?.data || report.type === "rir" || report.type === "time") return ["All", ...MUSCLE_GROUPS];
    return ["All", ...[...new Set(report.data.map(r => r.muscleGroup))].sort()];
  }, [report]);

  function formatHM(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  const timeChartData = useMemo(() => {
    if (report?.type !== "time" || !report.data?.length) return [];
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const thisWeek = weekStart(todayStr);
    let startWeek;
    if (range === "all") {
      startWeek = weekStart(report.data[0].date);
    } else {
      const d = new Date(today);
      d.setDate(d.getDate() - parseInt(range) * 7);
      startWeek = weekStart(d.toISOString().slice(0, 10));
    }
    const cardioMap = new Map();
    const nonCardioMap = new Map();
    for (const row of report.data) {
      const ws = weekStart(row.date);
      if (ws < startWeek) continue;
      cardioMap.set(ws, (cardioMap.get(ws) || 0) + row.cardioSec);
      nonCardioMap.set(ws, (nonCardioMap.get(ws) || 0) + row.nonCardioSec);
    }
    const weeks = [];
    let cur = startWeek;
    while (cur <= thisWeek) {
      const cardio = cardioMap.get(cur) || 0;
      const nonCardio = nonCardioMap.get(cur) || 0;
      weeks.push({ week: cur, label: formatWeekLabel(cur), cardio, nonCardio, value: cardio + nonCardio });
      cur = addWeeks(cur, 1);
    }
    return weeks;
  }, [report, range]);

  const stats = useMemo(() => {
    if (report?.type === "time") {
      if (!timeChartData.length) return null;
      const nonZero = timeChartData.filter(d => d.value > 0);
      if (!nonZero.length) return null;
      const totalSec = nonZero.reduce((s, d) => s + d.value, 0);
      const avg = formatHM(Math.round(totalSec / timeChartData.length));
      const peak = formatHM(Math.max(...nonZero.map(d => d.value)));
      return { avg, peak, weeks: nonZero.length };
    }
    if (!chartData.length) return null;
    const nonZero = chartData.filter(d => d.value > 0);
    if (!nonZero.length) return null;
    const total = nonZero.reduce((s, d) => s + d.value, 0);
    const isVol = report?.type === "volume";
    const avg = (total / chartData.length).toFixed(isVol ? 0 : 1);
    const peak = Math.max(...nonZero.map(d => d.value));
    return { avg, peak: isVol ? Math.round(peak).toLocaleString() : peak, weeks: nonZero.length };
  }, [chartData, timeChartData, report]);

  function formatValue(v) {
    if (report?.type === "volume") return Math.round(v).toLocaleString();
    return v;
  }

  function BarChart({ data }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(340);
    const [tooltip, setTooltip] = useState(null);
    const isSets = report?.type === "sets";

    useEffect(() => {
      if (!containerRef.current) return;
      const obs = new ResizeObserver(entries => setWidth(entries[0].contentRect.width || 340));
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }, []);

    if (!data.length) return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)", fontSize: 14 }}>
        No data for this muscle group in this period.
      </div>
    );

    const W = width, H = 260, padL = 48, padR = 12, padT = 20, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const yMax = report?.type === "volume"
      ? Math.ceil(maxVal / 1000) * 1000 || 1000
      : Math.ceil(maxVal / 5) * 5 || 5;

    const slotW = chartW / n;
    const barW = Math.max(2, Math.min(28, slotW * 0.65));
    function bx(i) { return padL + i * slotW + slotW / 2; }
    function py(v) { return padT + chartH - (v / yMax) * chartH; }
    function bh(v) { return (v / yMax) * chartH; }

    // Linear regression trend line (on total value)
    const xs = data.map((_, i) => i);
    const ys = data.map(d => d.value);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = den !== 0 ? num / den : 0;
    const intercept = my - slope * mx;
    const showTrend = data.filter(d => d.value > 0).length >= 3;
    const ty0 = Math.max(0, Math.min(yMax, intercept));
    const ty1 = Math.max(0, Math.min(yMax, slope * (n - 1) + intercept));
    const rising = slope > 0.001;
    const falling = slope < -0.001;
    const trendColor = rising ? "var(--green)" : falling ? "var(--red)" : "var(--ink3)";
    const trendLabel = rising ? "Trending Up" : falling ? "Trending Down" : "Flat";
    const trendArrow = rising ? "▲" : falling ? "▼" : "—";

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMax * f));
    const labelEvery = n <= 12 ? 1 : n <= 26 ? 2 : Math.ceil(n / 12);
    function formatYTick(v) {
      if (report?.type === "volume" && v >= 1000) return `${(v / 1000).toFixed(0)}k`;
      return v;
    }

    // Legend for stacked sets chart
    const legend = isSets ? (
      <div style={{ display: "flex", gap: 14, marginBottom: 8, justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--orange)" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.06em" }}>PRIMARY</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "#4a90d9" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.06em" }}>SECONDARY</span>
        </div>
      </div>
    ) : null;

    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          {isSets ? legend : <div />}
          {showTrend && (
            <span style={{
              fontSize: 11, fontFamily: "var(--font-label)", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: trendColor,
              background: rising ? "rgba(26,122,58,0.10)" : falling ? "rgba(192,37,26,0.10)" : "rgba(0,0,0,0.06)",
              padding: "3px 8px", borderRadius: 3,
            }}>
              {trendArrow} {trendLabel}
            </span>
          )}
        </div>
        <svg width={W} height={H} style={{ display: "block", width: "100%", fontFamily: "var(--font-label)" }}
          onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTimeout(() => setTooltip(null), 1800)}>

          {yTicks.map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={py(v)} y2={py(v)} stroke="var(--cream3)" strokeWidth={1} />
              <text x={padL - 4} y={py(v) + 4} textAnchor="end" fill="var(--ink4)" fontSize={9}>{formatYTick(v)}</text>
            </g>
          ))}

          {data.map((d, i) => {
            const isHovered = tooltip?.i === i;
            const primary = d.primary ?? d.value;
            const secondary = d.secondary ?? 0;
            const hPrimary = bh(primary);
            const hSecondary = bh(secondary);
            const hTotal = bh(d.value);
            return (
              <g key={i} onMouseEnter={() => setTooltip({ i, d })} onTouchStart={() => setTooltip({ i, d })}>
                <rect x={bx(i) - slotW / 2} y={padT} width={slotW} height={chartH} fill="transparent" />
                {/* Primary sets — orange, bottom of stack */}
                {hPrimary > 0 && (
                  <rect x={bx(i) - barW / 2} y={py(primary)} width={barW} height={hPrimary} rx={2}
                    fill={isHovered ? "var(--orange2)" : "var(--orange)"}
                    opacity={isHovered ? 1 : 0.85} />
                )}
                {/* Secondary sets — blue, stacked on top */}
                {isSets && hSecondary > 0 && (
                  <rect x={bx(i) - barW / 2} y={py(d.value)} width={barW} height={hSecondary} rx={2}
                    fill="#4a90d9"
                    opacity={isHovered ? 1 : 0.75} />
                )}
              </g>
            );
          })}

          {showTrend && (
            <line
              x1={bx(0)} y1={padT + chartH - (ty0 / yMax) * chartH}
              x2={bx(n - 1)} y2={padT + chartH - (ty1 / yMax) * chartH}
              stroke={trendColor} strokeWidth={2.5} strokeDasharray="6 3"
              strokeLinecap="round" opacity={0.9} />
          )}

          {tooltip && (() => {
            const x = bx(tooltip.i);
            const d = tooltip.d;
            const y = py(d.value) - 6;
            const flip = x > W * 0.65;
            const primary = d.primary ?? d.value;
            const secondary = d.secondary ?? 0;
            const label = isSets && secondary > 0
              ? `${primary}+${secondary} · ${d.label}`
              : `${formatValue(d.value)} · ${d.label}`;
            const boxW = Math.min(label.length * 7 + 16, 160);
            const tx = flip ? x - boxW - 4 : x + 4;
            return (
              <g>
                <rect x={tx} y={y - 18} width={boxW} height={22} rx={3} fill="var(--black)" opacity={0.9} />
                <text x={tx + boxW / 2} y={y - 3} textAnchor="middle" fill="var(--card)" fontSize={10} fontWeight={700}>{label}</text>
              </g>
            );
          })()}

          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={i} x={bx(i)} y={H - 4} textAnchor="middle" fill="var(--ink4)" fontSize={9}>{d.label}</text>
          ))}
        </svg>
      </div>
    );
  }


  function VolumeLineChart({ data }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(340);
    const [tooltip, setTooltip] = useState(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const obs = new ResizeObserver(entries => setWidth(entries[0].contentRect.width || 340));
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }, []);

    if (!data.length || data.every(d => d.value === 0)) return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)", fontSize: 14 }}>
        No data for this muscle group in this period.
      </div>
    );

    const W = width, H = 280, padL = 52, padR = 40, padT = 24, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;

    // Left axis: total volume (stacked bars)
    const maxVol = Math.max(...data.map(d => d.value), 1);
    const yMaxVol = Math.ceil(maxVol / 1000) * 1000 || 1000;

    // Right axis: hi% line — auto-scaled to data range
    const pctData = data.map(d => d.value > 0 ? (d.hi / d.value) * 100 : null);
    const validPcts = pctData.filter(p => p !== null);
    const minPct = validPcts.length ? Math.floor(Math.min(...validPcts) / 5) * 5 : 0;
    const maxPct = validPcts.length ? Math.ceil(Math.max(...validPcts) / 5) * 5 : 100;
    const pctRange = maxPct - minPct || 10;

    const slotW = chartW / n;
    const barW = Math.max(2, Math.min(28, slotW * 0.65));

    function bx(i) { return padL + i * slotW + slotW / 2; }
    function pyVol(v) { return padT + chartH - (v / yMaxVol) * chartH; }
    function bhVol(v) { return Math.max(0, (v / yMaxVol) * chartH); }
    function pyPct(p) { return padT + chartH - ((p - minPct) / pctRange) * chartH; }

    const labelEvery = n <= 12 ? 1 : n <= 26 ? 2 : Math.ceil(n / 12);
    const volTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMaxVol * f));
    const pctTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(minPct + pctRange * f));

    function fmtVol(v) { return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v; }

    // Build polyline for hi% line — skip nulls
    const linePoints = data
      .map((d, i) => pctData[i] !== null ? `${bx(i)},${pyPct(pctData[i])}` : null)
      .filter(Boolean).join(" ");

    // Trend on the % line
    const trendPts = pctData.map((p, i) => p !== null ? { x: i, y: p } : null).filter(Boolean);
    const tn = trendPts.length;
    const showTrend = tn >= 3;
    let trendColor = "var(--ink3)", trendArrow = "—", trendLabel = "Flat";
    if (showTrend) {
      const tmx = trendPts.reduce((s, p) => s + p.x, 0) / tn;
      const tmy = trendPts.reduce((s, p) => s + p.y, 0) / tn;
      const tnum = trendPts.reduce((s, p) => s + (p.x - tmx) * (p.y - tmy), 0);
      const tden = trendPts.reduce((s, p) => s + (p.x - tmx) ** 2, 0);
      const slope = tden !== 0 ? tnum / tden : 0;
      const rising = slope > 0.05;
      const falling = slope < -0.05;
      trendColor = rising ? "var(--green)" : falling ? "var(--red)" : "var(--ink3)";
      trendArrow = rising ? "▲" : falling ? "▼" : "—";
      trendLabel = rising ? "Trending Up" : falling ? "Trending Down" : "Flat";
    }

    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        {/* Legend + trend */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--orange)" }} />
              <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink3)", letterSpacing: "0.06em" }}>HI INTENSITY</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--red)" }} />
              <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink3)", letterSpacing: "0.06em" }}>STANDARD</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <svg width={20} height={12}><polyline points="0,9 10,3 20,6" fill="none" stroke="#4a90d9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink3)", letterSpacing: "0.06em" }}>HI%</span>
            </div>
          </div>
          {showTrend && (
            <span style={{
              fontSize: 11, fontFamily: "var(--font-label)", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase", color: trendColor,
              background: trendColor === "var(--green)" ? "rgba(26,122,58,0.10)" : trendColor === "var(--red)" ? "rgba(192,37,26,0.10)" : "rgba(0,0,0,0.06)",
              padding: "3px 8px", borderRadius: 3,
            }}>{trendArrow} {trendLabel}</span>
          )}
        </div>

        <svg width={W} height={H} style={{ display: "block", width: "100%", fontFamily: "var(--font-label)" }}
          onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTimeout(() => setTooltip(null), 1800)}>

          {/* Left axis — volume */}
          {volTicks.map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={pyVol(v)} y2={pyVol(v)} stroke="var(--cream3)" strokeWidth={1} />
              <text x={padL - 4} y={pyVol(v) + 4} textAnchor="end" fill="var(--ink4)" fontSize={9}>{fmtVol(v)}</text>
            </g>
          ))}

          {/* Right axis — hi% */}
          {pctTicks.map(p => (
            <text key={p} x={W - padR + 4} y={pyPct(p) + 4} textAnchor="start" fill="#4a90d9" fontSize={9} opacity={0.85}>{p}%</text>
          ))}

          {/* Stacked bars */}
          {data.map((d, i) => {
            const totalH = bhVol(d.value);
            const hiH = bhVol(d.hi || 0);
            const stdH = totalH - hiH;
            const isHov = tooltip?.i === i;
            const x = bx(i) - barW / 2;
            return (
              <g key={i} onMouseEnter={() => setTooltip({ i, d })} onTouchStart={() => setTooltip({ i, d })}>
                <rect x={bx(i) - slotW / 2} y={padT} width={slotW} height={chartH} fill="transparent" />
                {/* Standard volume (top, lighter) */}
                {stdH > 0 && (
                  <rect x={x} y={pyVol(d.value)} width={barW} height={stdH} rx={0}
                    fill="var(--red)" opacity={isHov ? 1 : 0.9} />
                )}
                {/* Hi-intensity volume (bottom, orange) */}
                {hiH > 0 && (
                  <rect x={x} y={pyVol(d.hi || 0)} width={barW} height={hiH}
                    rx={2} fill={isHov ? "var(--orange2)" : "var(--orange)"} opacity={isHov ? 1 : 0.85}
                    style={{ borderRadius: stdH > 0 ? "0 0 2px 2px" : "2px" }} />
                )}
              </g>
            );
          })}

          {/* Hi% line */}
          {linePoints && (
            <polyline points={linePoints} fill="none" stroke="#4a90d9"
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          )}

          {/* Dots on line */}
          {data.map((d, i) => pctData[i] !== null && (
            <circle key={i} cx={bx(i)} cy={pyPct(pctData[i])} r={tooltip?.i === i ? 5 : 3}
              fill={tooltip?.i === i ? "#4a90d9" : "var(--card)"}
              stroke="#4a90d9" strokeWidth={2} />
          ))}

          {/* Tooltip */}
          {tooltip && (() => {
            const d = tooltip.d;
            const pct = d.value > 0 ? ((d.hi / d.value) * 100).toFixed(1) : "—";
            const stdVol = d.value - (d.hi || 0);
            const x = bx(tooltip.i);
            const flip = x > W * 0.6;
            const boxW = 160;
            const tx = flip ? x - boxW - 6 : x + 6;
            const ty = padT + 6;
            return (
              <g>
                <rect x={tx} y={ty} width={boxW} height={56} rx={3} fill="var(--black)" opacity={0.92} />
                <text x={tx + 8} y={ty + 14} fill="var(--ink4)" fontSize={9}>{d.label}</text>
                <text x={tx + 8} y={ty + 28} fill="var(--orange)" fontSize={10} fontWeight={700}>Hi: {Math.round(d.hi || 0).toLocaleString()} ({pct}%)</text>
                <text x={tx + 8} y={ty + 42} fill="var(--red)" fontSize={10} fontWeight={700}>Std: {Math.round(stdVol).toLocaleString()}</text>
              </g>
            );
          })()}

          {/* X labels */}
          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={i} x={bx(i)} y={H - 4} textAnchor="middle" fill="var(--ink4)" fontSize={9}>{d.label}</text>
          ))}
        </svg>

        {/* Insight note */}
        <div style={{ marginTop: 8, padding: "10px 14px", background: "var(--cream)", borderRadius: 3, border: "1px solid var(--cream3)" }}>
          <div style={{ fontSize: 12, color: "var(--ink3)", fontFamily: "var(--font-label)", lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>High-intensity volume </span>
            counts reps × weight only for reps estimated above 75% of your 1RM. Sets with no RIR logged assume RIR 4. The line shows what proportion of your total volume qualifies — a rising line means more of your work is in the productive zone.
          </div>
        </div>
      </div>
    );
  }

  function TimeStackedBarChart({ data }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(340);
    const [tooltip, setTooltip] = useState(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const obs = new ResizeObserver(entries => setWidth(entries[0].contentRect.width || 340));
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }, []);

    if (!data.length || data.every(d => d.value === 0)) return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)", fontSize: 14 }}>
        No workout time recorded in this period.
      </div>
    );

    const W = width, H = 260, padL = 48, padR = 12, padT = 20, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    // Round up to nearest 30 minutes in seconds
    const yMaxSec = Math.ceil(maxVal / 1800) * 1800 || 3600;
    const slotW = chartW / n;
    const barW = Math.max(2, Math.min(28, slotW * 0.65));

    function bx(i) { return padL + i * slotW + slotW / 2; }
    function py(v) { return padT + chartH - (v / yMaxSec) * chartH; }
    function bh(v) { return (v / yMaxSec) * chartH; }

    // Y-axis ticks in hours
    const hourTicks = [];
    for (let s = 0; s <= yMaxSec; s += 3600) hourTicks.push(s);
    if (!hourTicks.includes(yMaxSec)) hourTicks.push(yMaxSec);

    // Trend line on total value
    const xs = data.map((_, i) => i);
    const ys = data.map(d => d.value);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = den !== 0 ? num / den : 0;
    const intercept = my - slope * mx;
    const showTrend = data.filter(d => d.value > 0).length >= 3;
    const ty0 = Math.max(0, Math.min(yMaxSec, intercept));
    const ty1 = Math.max(0, Math.min(yMaxSec, slope * (n - 1) + intercept));
    const rising = slope > 30; // > 30 seconds per week
    const falling = slope < -30;
    const trendColor = rising ? "var(--green)" : falling ? "var(--red)" : "var(--ink3)";
    const trendLabel = rising ? "Trending Up" : falling ? "Trending Down" : "Flat";
    const trendArrow = rising ? "▲" : falling ? "▼" : "—";

    const labelEvery = n <= 12 ? 1 : n <= 26 ? 2 : Math.ceil(n / 12);

    const legend = (
      <div style={{ display: "flex", gap: 14, marginBottom: 8, justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--orange)" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.06em" }}>LIFTING</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "#2cb5a0" }} />
          <span style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.06em" }}>CARDIO</span>
        </div>
      </div>
    );

    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          {legend}
          {showTrend && (
            <span style={{
              fontSize: 11, fontFamily: "var(--font-label)", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: trendColor,
              background: rising ? "rgba(26,122,58,0.10)" : falling ? "rgba(192,37,26,0.10)" : "rgba(0,0,0,0.06)",
              padding: "3px 8px", borderRadius: 3,
            }}>
              {trendArrow} {trendLabel}
            </span>
          )}
        </div>
        <svg width={W} height={H} style={{ display: "block", width: "100%", fontFamily: "var(--font-label)" }}
          onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTimeout(() => setTooltip(null), 1800)}>

          {hourTicks.map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={py(v)} y2={py(v)} stroke="var(--cream3)" strokeWidth={1} />
              <text x={padL - 4} y={py(v) + 4} textAnchor="end" fill="var(--ink4)" fontSize={9}>
                {v === 0 ? "0" : `${v / 3600}h`}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const isHovered = tooltip?.i === i;
            const hLifting = bh(d.nonCardio);
            const hCardio = bh(d.cardio);
            const yLifting = py(d.nonCardio);
            const yCardio = py(d.value); // stacked on top of lifting
            return (
              <g key={i} onMouseEnter={() => setTooltip({ i, d })} onTouchStart={() => setTooltip({ i, d })}>
                <rect x={bx(i) - slotW / 2} y={padT} width={slotW} height={chartH} fill="transparent" />
                {hLifting > 0 && (
                  <rect x={bx(i) - barW / 2} y={yLifting} width={barW} height={hLifting} rx={2}
                    fill={isHovered ? "var(--orange2)" : "var(--orange)"} opacity={isHovered ? 1 : 0.85} />
                )}
                {hCardio > 0 && (
                  <rect x={bx(i) - barW / 2} y={yCardio} width={barW} height={hCardio} rx={2}
                    fill="#2cb5a0" opacity={isHovered ? 1 : 0.8} />
                )}
              </g>
            );
          })}

          {showTrend && (
            <line
              x1={bx(0)} y1={padT + chartH - (ty0 / yMaxSec) * chartH}
              x2={bx(n - 1)} y2={padT + chartH - (ty1 / yMaxSec) * chartH}
              stroke={trendColor} strokeWidth={2.5} strokeDasharray="6 3"
              strokeLinecap="round" opacity={0.9} />
          )}

          {tooltip && (() => {
            const x = bx(tooltip.i);
            const d = tooltip.d;
            const flip = x > W * 0.65;
            const liftLine = d.nonCardio > 0 ? `${formatHM(d.nonCardio)} lifting` : null;
            const cardioLine = d.cardio > 0 ? `${formatHM(d.cardio)} cardio` : null;
            const lines = [d.label, liftLine, cardioLine].filter(Boolean);
            const boxW = 120;
            const boxH = lines.length * 14 + 10;
            const tx = flip ? x - boxW - 4 : x + 4;
            const ty = py(d.value) - boxH - 4;
            return (
              <g>
                <rect x={tx} y={ty} width={boxW} height={boxH} rx={3} fill="var(--black)" opacity={0.9} />
                {lines.map((line, li) => (
                  <text key={li} x={tx + boxW / 2} y={ty + 14 + li * 13} textAnchor="middle"
                    fill={li === 1 && d.nonCardio > 0 ? "var(--orange)" : li === 2 || (li === 1 && d.nonCardio === 0) ? "#2cb5a0" : "var(--ink4)"}
                    fontSize={10} fontWeight={li === 0 ? 400 : 700}>{line}</text>
                ))}
              </g>
            );
          })()}

          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={i} x={bx(i)} y={H - 4} textAnchor="middle" fill="var(--ink4)" fontSize={9}>{d.label}</text>
          ))}
        </svg>
      </div>
    );
  }

  function RIRAccuracyView({ rows, exStats }) {
    // Apply date range filter
    const cutoff = range === "all" ? "0000-00-00" : (() => {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(range) * 7);
      return d.toISOString().slice(0, 10);
    })();
    const filtered = rows.filter(r => r.date >= cutoff);

    // Build exercise list with ≥3 qualifying sets
    const countByEx = {};
    for (const r of filtered) countByEx[r.exerciseName] = (countByEx[r.exerciseName] || 0) + 1;
    const eligibleExercises = Object.entries(countByEx).filter(([, n]) => n >= 3).map(([name]) => name).sort();

    // Auto-select first exercise if none selected or current not eligible
    const effectiveExercise = eligibleExercises.includes(rirExercise) ? rirExercise : (eligibleExercises[0] || "");

    const exerciseRows = filtered.filter(r => r.exerciseName === effectiveExercise);
    const stat = exStats[effectiveExercise];

    function discrepancyColor(d) {
      const abs = Math.abs(d);
      if (abs <= 1) return "var(--green)";
      if (abs === 2) return "var(--orange)";
      return "var(--red)";
    }

    // Summary stats
    const accurateCount = exerciseRows.filter(r => Math.abs(r.discrepancy) <= 1).length;
    const accuratePct = exerciseRows.length > 0 ? Math.round((accurateCount / exerciseRows.length) * 100) : 0;
    const avgDisc = exerciseRows.length > 0
      ? exerciseRows.reduce((s, r) => s + r.discrepancy, 0) / exerciseRows.length
      : 0;
    const avgDiscStr = (avgDisc >= 0 ? "+" : "") + avgDisc.toFixed(1);

    const toggle = (
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["exercise", "ranked"].map(v => (
          <button key={v} onClick={() => setRirView(v)}
            style={{ ...btnStyle(rirView === v ? "primary" : "ghost"), padding: "6px 14px", fontSize: 12, flex: 1 }}>
            {v === "exercise" ? "By Exercise" : "Ranked"}
          </button>
        ))}
      </div>
    );

    if (rirView === "ranked") {
      // Aggregate per exercise: min 5 qualifying sets
      const aggMap = {};
      for (const r of filtered) {
        if (!aggMap[r.exerciseName]) aggMap[r.exerciseName] = { cumulative: 0, sumSigned: 0, count: 0 };
        aggMap[r.exerciseName].cumulative += Math.abs(r.discrepancy);
        aggMap[r.exerciseName].sumSigned  += r.discrepancy;
        aggMap[r.exerciseName].count      += 1;
      }
      const ranked = Object.entries(aggMap)
        .filter(([, a]) => a.count >= 5)
        .map(([name, a]) => ({
          name,
          cumulativeDiscrepancy: a.cumulative,
          averageDiscrepancy: a.sumSigned / a.count,
          qualifyingSets: a.count,
        }))
        .sort((a, b) => b.averageDiscrepancy - a.averageDiscrepancy);

      function severityColor(avgDisc) {
        const abs = Math.abs(avgDisc);
        if (abs < 1.5) return "var(--green)";
        if (abs < 2.5) return "var(--orange)";
        return "var(--red)";
      }

      return (
        <div>
          {toggle}
          {ranked.length === 0 ? (
            <div style={{ color: "var(--ink4)", fontSize: 13, textAlign: "center", padding: 24 }}>
              No exercises with 5+ qualifying sets in this period.
            </div>
          ) : ranked.map((ex, i) => {
            const color = severityColor(ex.averageDiscrepancy);
            const avgStr = (ex.averageDiscrepancy >= 0 ? "+" : "") + ex.averageDiscrepancy.toFixed(1);
            return (
              <div key={ex.name} onClick={() => { setRirView("exercise"); setRirExercise(ex.name); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px",
                  borderBottom: "1px solid var(--cream3)", cursor: "pointer" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--ink4)", width: 22, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ex.name.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.04em", marginTop: 2 }}>
                    {ex.qualifyingSets} qualifying sets
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color, letterSpacing: "0.04em" }}>{avgStr}</div>
                  <div style={{ fontSize: 10, fontFamily: "var(--font-label)", color: "var(--ink4)", letterSpacing: "0.04em" }}>
                    avg RIR diff
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (eligibleExercises.length === 0) {
      return (
        <div>
          {toggle}
          <div style={{ color: "var(--ink4)", fontSize: 13, textAlign: "center", padding: 24 }}>
            No exercises with 3+ qualifying sets (reps 3–12, RIR logged, e1RM stored) in this period.
          </div>
        </div>
      );
    }

    return (
      <div>
        {toggle}
        <div style={{ marginBottom: 12 }}>
          <label style={{ ...labelStyle, marginBottom: 4 }}>Exercise</label>
          <select value={effectiveExercise} onChange={e => setRirExercise(e.target.value)}
            style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
            {eligibleExercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
          </select>
        </div>

        {exerciseRows.length > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--cream)", borderRadius: 3, border: "1px solid var(--cream3)", fontSize: 12, color: "var(--ink3)", lineHeight: 1.6 }}>
            Accurate within 1 rep on <strong>{accuratePct}%</strong> of sets. Average discrepancy: <strong>{avgDiscStr} reps</strong>.
            {stat && (
              <span style={{ color: "var(--ink4)" }}>
                {" "}[{stat.bestE1RMSource === "0-RIR" ? `anchored to 0-RIR set from ${stat.bestE1RMDate}` : "estimated e1RM"}]
              </span>
            )}
          </div>
        )}

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Date", "Weight × Reps", "Rep. RIR", "Calc. RIR", "Disc."].map(h => (
                  <th key={h} style={{ ...labelStyle, display: "table-cell", fontSize: 10, padding: "4px 6px", textAlign: h === "Date" || h === "Weight × Reps" ? "left" : "center", borderBottom: "1.5px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...exerciseRows].reverse().map((r, i) => {
                const color = discrepancyColor(r.discrepancy);
                const sign = r.discrepancy > 0 ? "+" : "";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--cream3)" }}>
                    <td style={{ padding: "6px 6px", color: "var(--ink3)", whiteSpace: "nowrap" }}>{r.date}</td>
                    <td style={{ padding: "6px 6px", fontWeight: 600 }}>{r.weight}lb × {r.reps}</td>
                    <td style={{ padding: "6px 6px", textAlign: "center" }}>{r.reportedRIR}</td>
                    <td style={{ padding: "6px 6px", textAlign: "center" }}>{r.calcRIR}</td>
                    <td style={{ padding: "6px 6px", textAlign: "center", fontWeight: 700, color }}>{sign}{r.discrepancy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const isVolume = report?.type === "volume";
  const isTime = report?.type === "time";
  const isRIR = report?.type === "rir";
  const statLabels = isTime
    ? ["Avg Time/Wk", "Peak Week", "Active Weeks"]
    : isVolume
      ? ["Avg Vol/Wk", "Peak Week", "Active Weeks"]
      : ["Avg Sets/Wk", "Peak Week", "Active Weeks"];

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      {/* Report selector card */}
      <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12 }}>
        <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
          <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Analytics</span>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Report</label>
            <select value={selectedReport} onChange={e => { setSelectedReport(e.target.value); setReport(null); }}
              style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
              {REPORTS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <div style={{ fontSize: 12, color: "var(--ink4)", marginTop: 4 }}>
              {REPORTS.find(r => r.id === selectedReport)?.desc}
            </div>
          </div>
          <button onClick={runReport} disabled={running}
            style={{ ...btnStyle("primary"), width: "100%", padding: "11px", boxShadow: "0 2px 0 var(--red)" }}>
            {running ? "Loading…" : report ? "↺ Re-run Report" : "▶ Run Report"}
          </button>
        </div>
      </div>

      {/* Full-screen landscape overlay */}
      {report && expanded && (() => {
        const isPortrait = window.innerHeight > window.innerWidth;
        const overlayContent = {
          position: "absolute", top: "50%", left: "50%",
          overflow: "auto", padding: 12, boxSizing: "border-box",
          ...(isPortrait
            ? { width: "100vh", height: "100vw", transform: "translate(-50%, -50%) rotate(90deg)" }
            : { width: "100vw", height: "100vh", transform: "translate(-50%, -50%)" }),
        };
        return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--card)" }}>
          <button onClick={() => setExpanded(false)}
            style={{ position: "absolute", top: 14, right: 14, zIndex: 201, background: "var(--orange)", border: "none", color: "#fff", borderRadius: "50%", width: 34, height: 34, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
          <div style={overlayContent}>
            {isRIR ? (
              <RIRAccuracyView rows={report.data.rows || []} exStats={report.data.exStats || {}} />
            ) : isTime ? (
              <TimeStackedBarChart data={timeChartData} />
            ) : report.type === "volume" ? (
              <VolumeLineChart data={chartData} />
            ) : (
              <BarChart data={chartData} />
            )}
          </div>
        </div>
        );
      })()}

      {/* Chart card — only shown after report runs */}
      {report && (
        <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
              <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>
                {REPORTS.find(r => r.id === report.type)?.label}
              </span>
            </div>
            <button onClick={() => setExpanded(true)}
              style={{ background: "none", border: "none", color: "var(--ink4)", fontSize: 15, cursor: "pointer", padding: "2px 4px", lineHeight: 1, borderRadius: 3 }}
              title="Expand to landscape">⛶</button>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: (isTime || isRIR) ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {!isTime && !isRIR && (
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 4 }}>Muscle Group</label>
                    <select value={muscleGroup} onChange={e => setMuscleGroup(e.target.value)}
                      style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
                      {availableGroups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ ...labelStyle, marginBottom: 4 }}>Period</label>
                  <select value={range} onChange={e => setRange(e.target.value)}
                    style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
                    <option value="8">8 Weeks</option>
                    <option value="12">12 Weeks</option>
                    <option value="26">6 Months</option>
                    <option value="52">1 Year</option>
                    <option value="all">All Time</option>
                  </select>
                </div>
              </div>
            {isRIR ? (
              <RIRAccuracyView rows={report.data.rows || []} exStats={report.data.exStats || {}} />
            ) : isTime ? (
              <TimeStackedBarChart data={timeChartData} />
            ) : report.type === "volume" ? (
              <VolumeLineChart data={chartData} />
            ) : (
              <BarChart data={chartData} />
            )}
            {!isRIR && stats && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
                {[stats.avg, stats.peak, stats.weeks].map((value, i) => (
                  <div key={i} style={{ background: "var(--cream)", border: "1.5px solid var(--cream3)", borderRadius: 4, padding: "10px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1 }}>{value}</div>
                    <div style={{ ...labelStyle, fontSize: 9, marginTop: 3, color: "var(--ink4)" }}>{statLabels[i]}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("history");
  const [analyticsKey, setAnalyticsKey] = useState(0);
  const [logging, setLogging] = useState(() => {
    // Auto-resume if a draft workout exists
    try { return !!localStorage.getItem(WORKOUT_DRAFT_KEY); } catch { return false; }
  });
  const [pendingTemplate, setPendingTemplate] = useState(null);

  function startFromTemplate(t) {
    setPendingTemplate(t);
    setLogging(true);
  }
  const [library, setLibrary] = useState({
    locations: [], workoutTypes: DEFAULT_WORKOUT_TYPES,
    exerciseGroups: ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"], exercises: []
  });
  const [restPrefs, setRestPrefs] = useState({});
  const [templates, setTemplates] = useState([]);

  useEffect(() => onAuthStateChanged(auth, u => setUser(u || null)), []);

  useEffect(() => {
    if (!user) return;
    backfillExerciseStats(user.uid).catch(console.error);
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "meta", "library");
    const unsub = onSnapshot(ref, async snap => {
      if (snap.exists()) {
        const data = snap.data();
        // ── Existing user migration (runs once) ──────────────────────────────
        if (!data.libraryMigrated) {
          const exerciseNames = EXERCISE_LIBRARY.map(e => e.name);
          const existing = data.exercises || [];
          const merged = [...new Set([...exerciseNames, ...existing])];
          const migrationData = {
            exercises: merged,
            workoutTypes: DEFAULT_WORKOUT_TYPES,
            muscleGroupMappings: MUSCLE_GROUP_MAPPINGS,
            volumeLandmarks: VOLUME_LANDMARKS,
            libraryMigrated: true,
          };
          setDoc(ref, migrationData, { merge: true }).catch(console.error);
          setLibrary(prev => ({ ...prev, ...data, ...migrationData }));
        } else {
          setLibrary(prev => ({ ...prev, ...data }));
        }
        if (data.restPrefs) setRestPrefs(data.restPrefs);
      } else {
        // ── New user seeding (first login) ───────────────────────────────────
        const exerciseNames = EXERCISE_LIBRARY.map(e => e.name);
        const seedData = {
          exercises: exerciseNames,
          muscleGroupMappings: MUSCLE_GROUP_MAPPINGS,
          volumeLandmarks: VOLUME_LANDMARKS,
          locations: [],
          workoutTypes: DEFAULT_WORKOUT_TYPES,
          exerciseGroups: ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"],
          restPrefs: {},
          libraryMigrated: true,
        };
        setDoc(ref, seedData).catch(console.error);
        setLibrary(prev => ({ ...prev, ...seedData }));
      }
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "users", user.uid, "templates"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  const seedLibrary = useCallback(async () => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "meta", "library");
    const exerciseNames = EXERCISE_LIBRARY.map(e => e.name);
    setLibrary(prev => {
      const existing = prev.exercises || [];
      const merged = [...new Set([...exerciseNames, ...existing])];
      const updated = { ...prev, exercises: merged, muscleGroupMappings: MUSCLE_GROUP_MAPPINGS };
      setDoc(ref, { exercises: merged, muscleGroupMappings: MUSCLE_GROUP_MAPPINGS }, { merge: true }).catch(console.error);
      return updated;
    });
  }, [user]);

  const addToLibrary = useCallback(async (key, value, muscleGroup) => {
    if (!user || !value || !value.trim()) return;
    const trimmed = value.trim();
    setLibrary(prev => {
      const list = prev[key] || [];
      const alreadyExists = list.map(i => i.toLowerCase()).includes(trimmed.toLowerCase());
      const firestoreUpdate = {};
      let updated = prev;

      if (!alreadyExists) {
        updated = { ...prev, [key]: [...list, trimmed] };
        firestoreUpdate[key] = updated[key];
      }

      if (key === "exercises" && muscleGroup && !prev.muscleGroupMappings?.[trimmed]) {
        const updatedMappings = { ...(prev.muscleGroupMappings || {}), [trimmed]: { primaryGroup: muscleGroup, secondaryGroups: {} } };
        updated = { ...updated, muscleGroupMappings: updatedMappings };
        firestoreUpdate.muscleGroupMappings = updatedMappings;
      }

      if (Object.keys(firestoreUpdate).length === 0) return prev;
      setDoc(doc(db, "users", user.uid, "meta", "library"), firestoreUpdate, { merge: true }).catch(console.error);
      return updated;
    });
  }, [user]);

  const updateRestPref = useCallback((exerciseName, secs) => {
    if (!user || !exerciseName) return;
    setRestPrefs(prev => {
      const updated = { ...prev, [exerciseName]: secs };
      setDoc(doc(db, "users", user.uid, "meta", "library"), { restPrefs: updated }, { merge: true }).catch(console.error);
      return updated;
    });
  }, [user]);

  if (user === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 46, color: "var(--ink)", letterSpacing: "0.04em", animation: "pulse 1.5s infinite" }}>FITTRACKR</div>
    </div>
  );

  if (!user) return <SignIn />;

  const onWorkoutEnd = () => { clearWorkoutDraft(); setLogging(false); setPendingTemplate(null); setTab("history"); };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", paddingBottom: 70 }}>
      {/* App header — hidden while active workout is fullscreen on Log tab */}
      {!(logging && tab === "log") && (
        <div style={{ background: "var(--cream)", borderBottom: "2.5px solid var(--ink)" }}>
          <div style={{ padding: "16px 18px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 8, letterSpacing: "0.32em", color: "var(--ink3)", textTransform: "uppercase", marginBottom: 6, fontWeight: 300, fontFamily: "var(--font-label)" }}>Workout Tracker</div>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 46, color: "var(--ink)", letterSpacing: "0.04em", lineHeight: 0.85 }}>FIT<br/>TRACKR</h1>
              <div style={{ fontSize: 8, letterSpacing: "0.22em", color: "var(--ink3)", marginTop: 6, fontWeight: 300, fontFamily: "var(--font-label)", textTransform: "uppercase" }}>
                {tab === "history" ? "Training History" : tab === "analytics" ? "Analytics" : tab === "templates" ? "Templates" : tab === "lookup" ? "Exercise Lookup" : "Profile"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <div style={{ position: "relative", width: 64, height: 64, marginTop: 4 }}>
                <div style={{ position: "absolute", width: 64, height: 64, border: "2.5px solid var(--ink)", borderRadius: "50%" }} />
                <div style={{ position: "absolute", width: 42, height: 42, top: 11, left: 11, background: "var(--yellow)", borderRadius: "50%" }} />
                <div style={{ position: "absolute", width: 21, height: 21, top: 21.5, left: 21.5, background: "var(--ink)", borderRadius: "50%" }} />
                <div style={{ position: "absolute", width: 7, height: 7, top: 28.5, left: 28.5, background: "var(--yellow)", borderRadius: "50%" }} />
              </div>
              {user?.photoURL && <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: 0, border: "2px solid var(--yellow)" }} alt="" />}
            </div>
          </div>
        </div>
      )}

      {/* Active workout — always mounted when logging so timers keep running; hidden via display:none when on another tab */}
      {logging && (
        <div style={{ display: tab === "log" ? "block" : "none" }}>
          <ActiveWorkout uid={user.uid} user={user} library={library} onAddToLibrary={addToLibrary}
            onEnd={onWorkoutEnd}
            restPrefs={restPrefs} onRestPrefChange={updateRestPref}
            templates={templates} onSaveTemplate={() => {}}
            pendingTemplate={pendingTemplate} />
        </div>
      )}

      {/* Tab screens */}
      {tab === "history"   && <HistoryScreen uid={user.uid} />}
      {tab === "lookup"    && <LookupScreen uid={user.uid} library={library} />}
      {tab === "analytics" && <AnalyticsScreen key={analyticsKey} uid={user.uid} />}
      {tab === "templates" && <TemplatesScreen uid={user.uid} templates={templates} onStartWorkout={t => { startFromTemplate(t); }} />}
      {tab === "profile"   && <ProfileScreen user={user} onSeedLibrary={seedLibrary} volumeBackfilled={!!library.volumeDataBackfilled} />}

      <BugReportButton uid={user.uid} currentTab={tab} />
      <BottomNav
        tab={tab}
        setTab={t => { if (t === "analytics") setAnalyticsKey(k => k + 1); setTab(t); }}
        onNewWorkout={() => { setTab("log"); setLogging(true); }}
        logging={logging}
      />
    </div>
  );
}
