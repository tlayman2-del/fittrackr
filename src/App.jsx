import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { auth, db } from "./firebase";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  doc, collection, addDoc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs, getDocsFromServer
} from "firebase/firestore";

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;500;600;700&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --cream: #f5f0e8; --cream2: #ede8df; --cream3: #e0dbd0;
    --orange: #FFA500; --orange2: #ffb732; --red: #c0251a; --pink: #e8305a;
    --black: #111111; --ink: #1a1a1a; --ink2: #3a3a3a; --ink3: #666666; --ink4: #999999;
    --green: #1a7a3a; --border: #c8c0b0;
    --card: #ffffff;
    --font-display: 'Bebas Neue', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --font-label: 'Oswald', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --font-body: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  body.dark {
    --cream: #1a1a1a; --cream2: #242424; --cream3: #2e2e2e;
    --black: #f0f0f0; --ink: #f0f0f0; --ink2: #cccccc; --ink3: #aaaaaa; --ink4: #777777;
    --border: #3a3a3a; --green: #2ecc71; --card: #242424;
  }
  html, body, #root {
    height: 100%; width: 100%; background: var(--cream); color: var(--ink);
    font-family: var(--font-body); -webkit-font-smoothing: antialiased; overscroll-behavior: none;
  }
  input, select, button { font-family: var(--font-body); }
  body.dark input, body.dark select, body.dark textarea {
    background: #2e2e2e !important; color: #f0f0f0 !important; border-color: #3a3a3a !important;
  }
  body.dark button { color: var(--ink); }
  body.dark [data-white] { background: #242424 !important; border-color: #3a3a3a !important; color: var(--ink) !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--cream2); }
  ::-webkit-scrollbar-thumb { background: var(--orange); border-radius: 2px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  .fade-in { animation: fadeIn 0.25s ease forwards; }
  .stripe-accent { position: relative; }
  .stripe-accent::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px;
    background: var(--orange); border-radius: 3px 0 0 3px;
  }
  .stripe-accent-active::before {
    background: linear-gradient(to bottom, var(--orange) 50%, var(--pink) 50%); width: 8px;
  }
`;
const styleEl = document.createElement("style");
styleEl.textContent = globalCSS;
document.head.appendChild(styleEl);

// Restore dark mode before first paint
if (localStorage.getItem("fittrackr-dark") === "1") document.body.classList.add("dark");

const MUSCLE_GROUPS = ["Abductors","Adductors","Back","Biceps","Calves","Cardio","Chest","Core","Glutes","Hamstrings","Quads","Shoulders","Traps","Triceps","Other"];


const EXERCISE_LIBRARY = [
  {"name": "Arnold Press (Dumbbell)", "muscleGroup": "Shoulders"},
  {"name": "Back Extension", "muscleGroup": "Back"},
  {"name": "Backwards Walking", "muscleGroup": "Cardio"},
  {"name": "Balance - Clock Touches", "muscleGroup": "Cardio"},
  {"name": "Banded Bench Press (Speed)", "muscleGroup": "Chest"},
  {"name": "Banded Jumps", "muscleGroup": "Cardio"},
  {"name": "Banded Speed Bench", "muscleGroup": "Chest"},
  {"name": "Barbell Overhead Marches", "muscleGroup": "Cardio"},
  {"name": "Barbell Shrugs Wide Grip", "muscleGroup": "Traps"},
  {"name": "Barbell split squat", "muscleGroup": "Quads"},
  {"name": "Belt Cable Sissy Squat (Home)", "muscleGroup": "Quads"},
  {"name": "Belt Landmine Squat", "muscleGroup": "Quads"},
  {"name": "Bench Press (Barbell)", "muscleGroup": "Chest"},
  {"name": "Bench Press (Dumbbell Partials)", "muscleGroup": "Chest"},
  {"name": "Bench Press (Dumbbell)", "muscleGroup": "Chest"},
  {"name": "Bent Over One Arm Row (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Bent Over Row (Barbell)", "muscleGroup": "Back"},
  {"name": "Bent Over Row (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Bicep Curl (Barbell)", "muscleGroup": "Biceps"},
  {"name": "Bicep Curl (Cable)", "muscleGroup": "Biceps"},
  {"name": "Bicep Curl (Dumbbell)", "muscleGroup": "Biceps"},
  {"name": "Bicep Curl (Machine)", "muscleGroup": "Biceps"},
  {"name": "Box Jump", "muscleGroup": "Cardio"},
  {"name": "Box Squat (Barbell)", "muscleGroup": "Quads"},
  {"name": "Box Step Up", "muscleGroup": "Quads"},
  {"name": "Bulgarian Split Squat", "muscleGroup": "Quads"},
  {"name": "Burpee", "muscleGroup": "Cardio"},
  {"name": "Cable Adductor", "muscleGroup": "Glutes"},
  {"name": "Cable Chop (Upper)", "muscleGroup": "Core"},
  {"name": "Cable Crossbody Lateral Raise", "muscleGroup": "Shoulders"},
  {"name": "Cable Crossover", "muscleGroup": "Chest"},
  {"name": "Cable Crunch", "muscleGroup": "Core"},
  {"name": "Cable Hip Thrusts (Home)", "muscleGroup": "Glutes"},
  {"name": "Calf Press on Leg Press", "muscleGroup": "Calves"},
  {"name": "Calf Press on Seated Leg Press", "muscleGroup": "Calves"},
  {"name": "Chest Dip", "muscleGroup": "Chest"},
  {"name": "Chest Dip (Assisted)", "muscleGroup": "Chest"},
  {"name": "Chest Fly (Dumbbell)", "muscleGroup": "Chest"},
  {"name": "Chest Press (Machine)", "muscleGroup": "Chest"},
  {"name": "Clamshell oblique raises", "muscleGroup": "Glutes"},
  {"name": "Clean (Barbell)", "muscleGroup": "Shoulders"},
  {"name": "Cobra Pulls", "muscleGroup": "Back"},
  {"name": "Concentration Curl (Dumbbell)", "muscleGroup": "Biceps"},
  {"name": "Cossack Squat", "muscleGroup": "Quads"},
  {"name": "Crunch (Machine)", "muscleGroup": "Core"},
  {"name": "Cycling (Indoor)", "muscleGroup": "Cardio"},
  {"name": "DB Sumo Deadlift", "muscleGroup": "Hamstrings"},
  {"name": "Dante Row", "muscleGroup": "Back"},
  {"name": "Deadlift (Barbell)", "muscleGroup": "Glutes"},
  {"name": "Deadlift (Dumbbell)", "muscleGroup": "Glutes"},
  {"name": "Decline Crunch", "muscleGroup": "Core"},
  {"name": "Decline Situp", "muscleGroup": "Core"},
  {"name": "Deficit Barbell Row", "muscleGroup": "Back"},
  {"name": "Deficit Pushup", "muscleGroup": "Chest"},
  {"name": "Drop Steps (Plyos)", "muscleGroup": "Cardio"},
  {"name": "Dumbbell Front Rack Marches", "muscleGroup": "Core"},
  {"name": "Dumbbell Overhead Marches", "muscleGroup": "Core"},
  {"name": "Dumbbell RDL", "muscleGroup": "Hamstrings"},
  {"name": "EZ Bar Curls", "muscleGroup": "Biceps"},
  {"name": "Face Pull (Cable)", "muscleGroup": "Shoulders"},
  {"name": "Farmer Carry", "muscleGroup": "Core"},
  {"name": "Forearm - Hammer", "muscleGroup": "Biceps"},
  {"name": "Forearm DB Curl", "muscleGroup": "Biceps"},
  {"name": "Freemotion - Narrow Stance Squats", "muscleGroup": "Quads"},
  {"name": "Freemotion Cable Curls", "muscleGroup": "Biceps"},
  {"name": "Freemotion Cable Lateral Raises", "muscleGroup": "Shoulders"},
  {"name": "Freemotion Iso Lat Pulldowns", "muscleGroup": "Back"},
  {"name": "Freemotion Lat Prayers", "muscleGroup": "Back"},
  {"name": "Freemotion Lunge", "muscleGroup": "Quads"},
  {"name": "Freemotion Squat Machine", "muscleGroup": "Quads"},
  {"name": "Freemotion Squat Partial Reps", "muscleGroup": "Quads"},
  {"name": "Full ROM Lateral Raises", "muscleGroup": "Shoulders"},
  {"name": "Glute Bridge", "muscleGroup": "Glutes"},
  {"name": "Glute Kickback (Machine)", "muscleGroup": "Glutes"},
  {"name": "Goblet Squat (Kettlebell)", "muscleGroup": "Quads"},
  {"name": "Good morning dumbbell", "muscleGroup": "Back"},
  {"name": "Hack Squat", "muscleGroup": "Quads"},
  {"name": "Hack Squat (Barbell)", "muscleGroup": "Quads"},
  {"name": "Hammer Curl (Dumbbell)", "muscleGroup": "Biceps"},
  {"name": "Hammer Strength Lat Row", "muscleGroup": "Back"},
  {"name": "Hang Clean (Barbell)", "muscleGroup": "Shoulders"},
  {"name": "Hang Power Clean", "muscleGroup": "Shoulders"},
  {"name": "Hanging Knee Raise", "muscleGroup": "Core"},
  {"name": "Hanging Leg Raise", "muscleGroup": "Core"},
  {"name": "Hip Abductor (Machine)", "muscleGroup": "Abductors"},
  {"name": "Hip Adductor (Machine)", "muscleGroup": "Adductors"},
  {"name": "Hip Thrust (Barbell)", "muscleGroup": "Glutes"},
  {"name": "Incline Barbell Press (Narrow Grip)", "muscleGroup": "Chest"},
  {"name": "Incline Bench Press (Barbell)", "muscleGroup": "Chest"},
  {"name": "Incline Bench Press (Dumbbell)", "muscleGroup": "Chest"},
  {"name": "Incline Bench Press (Smith Machine)", "muscleGroup": "Chest"},
  {"name": "Incline Chest Fly (Dumbbell)", "muscleGroup": "Chest"},
  {"name": "Incline Curl (Dumbbell)", "muscleGroup": "Biceps"},
  {"name": "Incline Row (Barbell)", "muscleGroup": "Back"},
  {"name": "Incline Row (Cable Home)", "muscleGroup": "Back"},
  {"name": "Incline Row (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Iso-Lateral Row (Machine)", "muscleGroup": "Back"},
  {"name": "Kettlebell Swing", "muscleGroup": "Cardio"},
  {"name": "Kickstand RDL", "muscleGroup": "Hamstrings"},
  {"name": "Knee Raise (Captain's Chair)", "muscleGroup": "Core"},
  {"name": "Kneeling Plate Rotation", "muscleGroup": "Core"},
  {"name": "Landmine Front Squat", "muscleGroup": "Quads"},
  {"name": "Lat Prayer", "muscleGroup": "Back"},
  {"name": "Lat Pulldown (Cable)", "muscleGroup": "Back"},
  {"name": "Lat Pulldown (Single Arm)", "muscleGroup": "Back"},
  {"name": "Lat Pulldown - Underhand (Cable)", "muscleGroup": "Back"},
  {"name": "Lat Pulldown Neutral Grip", "muscleGroup": "Back"},
  {"name": "Lat Pulldowns (Narrow Grip)", "muscleGroup": "Back"},
  {"name": "Lateral Raise (Cable)", "muscleGroup": "Shoulders"},
  {"name": "Lateral Raise (Dumbbell)", "muscleGroup": "Shoulders"},
  {"name": "Lateral Side Jumps", "muscleGroup": "Cardio"},
  {"name": "Lateral Single Leg Pogo Hops", "muscleGroup": "Cardio"},
  {"name": "Leg Extension (Machine)", "muscleGroup": "Quads"},
  {"name": "Leg Extension Partials", "muscleGroup": "Quads"},
  {"name": "Leg Extensions (Home)", "muscleGroup": "Quads"},
  {"name": "Leg Press", "muscleGroup": "Quads"},
  {"name": "Leg Press - Single Leg", "muscleGroup": "Quads"},
  {"name": "Leg Press Partials", "muscleGroup": "Quads"},
  {"name": "Long Jump", "muscleGroup": "Cardio"},
  {"name": "Low Row Narrow Grip", "muscleGroup": "Back"},
  {"name": "Lunge (Barbell)", "muscleGroup": "Quads"},
  {"name": "Lunge (Bodyweight)", "muscleGroup": "Quads"},
  {"name": "Lunge (Dumbbell)", "muscleGroup": "Quads"},
  {"name": "Lying Leg Crunches", "muscleGroup": "Core"},
  {"name": "Lying Leg Curl (Machine)", "muscleGroup": "Hamstrings"},
  {"name": "Meadows Row", "muscleGroup": "Back"},
  {"name": "Medball Core Rolls", "muscleGroup": "Core"},
  {"name": "Nordic Hamstring Curl", "muscleGroup": "Hamstrings"},
  {"name": "Overhead Press (Barbell)", "muscleGroup": "Shoulders"},
  {"name": "Overhead Press (Dumbbell)", "muscleGroup": "Shoulders"},
  {"name": "Palloff Press", "muscleGroup": "Core"},
  {"name": "Pec Deck (Machine)", "muscleGroup": "Chest"},
  {"name": "Pec Deck - Shortened Crossbody", "muscleGroup": "Chest"},
  {"name": "Pendlay Row (Barbell)", "muscleGroup": "Back"},
  {"name": "Pendulum Squat (Home)", "muscleGroup": "Quads"},
  {"name": "Pin Press Bench", "muscleGroup": "Chest"},
  {"name": "Plyo - Box Jump Height", "muscleGroup": "Cardio"},
  {"name": "Plyo - Box Push Off", "muscleGroup": "Cardio"},
  {"name": "Plyo - Depth Jumps", "muscleGroup": "Cardio"},
  {"name": "Plyo - Four Square Hops", "muscleGroup": "Cardio"},
  {"name": "Plyo - Kneeling Wall Slams", "muscleGroup": "Cardio"},
  {"name": "Plyo - Landmine Presses", "muscleGroup": "Cardio"},
  {"name": "Plyo - Pogo Hops", "muscleGroup": "Cardio"},
  {"name": "Plyo - Rotational Wall Slams", "muscleGroup": "Cardio"},
  {"name": "Plyo - Single Leg Drop", "muscleGroup": "Cardio"},
  {"name": "Plyo - Single Leg Jump To Height", "muscleGroup": "Cardio"},
  {"name": "Plyo - Single Leg Line Hop", "muscleGroup": "Cardio"},
  {"name": "Plyo Box Jump To Step Off", "muscleGroup": "Cardio"},
  {"name": "Plyo Chest Falls", "muscleGroup": "Chest"},
  {"name": "Plyo Clapping Pushups", "muscleGroup": "Chest"},
  {"name": "Plyo Push Up To Plates", "muscleGroup": "Chest"},
  {"name": "Plyos - Lateral Jumps", "muscleGroup": "Cardio"},
  {"name": "Pogo hops", "muscleGroup": "Cardio"},
  {"name": "Power Clean", "muscleGroup": "Shoulders"},
  {"name": "Power Snatch (Barbell)", "muscleGroup": "Shoulders"},
  {"name": "Preacher Curl (Barbell)", "muscleGroup": "Biceps"},
  {"name": "Preacher Curl (Dumbbell)", "muscleGroup": "Biceps"},
  {"name": "Preacher Curl Cable", "muscleGroup": "Biceps"},
  {"name": "Pronated Forearm Curls", "muscleGroup": "Biceps"},
  {"name": "Pull Up", "muscleGroup": "Back"},
  {"name": "Pull Up (Assisted)", "muscleGroup": "Back"},
  {"name": "Pull Up (Band)", "muscleGroup": "Back"},
  {"name": "Pullover (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Push Up", "muscleGroup": "Chest"},
  {"name": "Rack Pull (Barbell)", "muscleGroup": "Back"},
  {"name": "Reverse Fly (Cable)", "muscleGroup": "Back"},
  {"name": "Reverse Fly (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Reverse Fly (Machine)", "muscleGroup": "Back"},
  {"name": "Reverse Flye Machine Single Arm", "muscleGroup": "Back"},
  {"name": "Reverse Nordic Curl", "muscleGroup": "Quads"},
  {"name": "Ring Pushup", "muscleGroup": "Chest"},
  {"name": "Romanian Deadlift (Barbell)", "muscleGroup": "Back"},
  {"name": "Romanian Deadlift (Dumbbell)", "muscleGroup": "Back"},
  {"name": "Rotational Kickstand Deadlift", "muscleGroup": "Hamstrings"},
  {"name": "Rowing (Machine)", "muscleGroup": "Cardio"},
  {"name": "Running", "muscleGroup": "Cardio"},
  {"name": "Running (Treadmill)", "muscleGroup": "Cardio"},
  {"name": "Safety Squats", "muscleGroup": "Quads"},
  {"name": "Seal Row - Dumbbell", "muscleGroup": "Back"},
  {"name": "Seated Cable Row (Home)", "muscleGroup": "Back"},
  {"name": "Seated Calf Press (Home)", "muscleGroup": "Calves"},
  {"name": "Seated Calf Raise (Machine)", "muscleGroup": "Calves"},
  {"name": "Seated Calf Raise (Plate Loaded)", "muscleGroup": "Calves"},
  {"name": "Seated Dumbbell Lateral Raise", "muscleGroup": "Shoulders"},
  {"name": "Seated Dumbbell Shrugs", "muscleGroup": "Shoulders"},
  {"name": "Seated Hammer Curls", "muscleGroup": "Biceps"},
  {"name": "Seated Leg Curl (Machine)", "muscleGroup": "Hamstrings"},
  {"name": "Seated Leg Press (Machine)", "muscleGroup": "Hamstrings"},
  {"name": "Seated One Arm Cable Row", "muscleGroup": "Back"},
  {"name": "Seated Overhead Press Machine", "muscleGroup": "Shoulders"},
  {"name": "Seated Row (Cable)", "muscleGroup": "Back"},
  {"name": "Seated Row (Machine)", "muscleGroup": "Back"},
  {"name": "Seated Single Arm Low.Row", "muscleGroup": "Back"},
  {"name": "Shoulder Press (Machine)", "muscleGroup": "Shoulders"},
  {"name": "Shoulder Wall Stands", "muscleGroup": "Shoulders"},
  {"name": "Shrug (Barbell)", "muscleGroup": "Traps"},
  {"name": "Shrug (Dumbbell)", "muscleGroup": "Traps"},
  {"name": "Shrug (Machine)", "muscleGroup": "Traps"},
  {"name": "Side Plank", "muscleGroup": "Core"},
  {"name": "Single Leg Bridge", "muscleGroup": "Glutes"},
  {"name": "Single Leg Cable Kickback (Home)", "muscleGroup": "Glutes"},
  {"name": "Single Leg Extension (Home)", "muscleGroup": "Core"},
  {"name": "Single Leg Glute Bridge", "muscleGroup": "Glutes"},
  {"name": "Single Leg Medial Glute Lateral Raise", "muscleGroup": "Glutes"},
  {"name": "Single Leg RDL", "muscleGroup": "Hamstrings"},
  {"name": "Single kettlebell deadlift", "muscleGroup": "Hamstrings"},
  {"name": "Sissy Squat", "muscleGroup": "Quads"},
  {"name": "Sit Up", "muscleGroup": "Core"},
  {"name": "Skullcrusher (Barbell)", "muscleGroup": "Triceps"},
  {"name": "Skullcrusher (Dumbbell)", "muscleGroup": "Triceps"},
  {"name": "Sled Push", "muscleGroup": "Cardio"},
  {"name": "Smith Machine Hack Squat", "muscleGroup": "Quads"},
  {"name": "Smith Machine Shrugs", "muscleGroup": "Traps"},
  {"name": "Smith Machine Standing Calf Raises", "muscleGroup": "Calves"},
  {"name": "Snap Drop to Box Jump", "muscleGroup": "Cardio"},
  {"name": "Snatch Grip Barbell Shrugs", "muscleGroup": "Traps"},
  {"name": "Speed Bench Press", "muscleGroup": "Chest"},
  {"name": "Split Squat - Dumbbell", "muscleGroup": "Quads"},
  {"name": "Squat (Barbell)", "muscleGroup": "Quads"},
  {"name": "Squat (Bodyweight)", "muscleGroup": "Quads"},
  {"name": "Squat (Smith Machine)", "muscleGroup": "Quads"},
  {"name": "Stairmaster", "muscleGroup": "Cardio"},
  {"name": "Standing Calf Press - Single Leg", "muscleGroup": "Calves"},
  {"name": "Standing Calf Press Freemotion", "muscleGroup": "Calves"},
  {"name": "Standing Calf Raise (Barbell)", "muscleGroup": "Calves"},
  {"name": "Standing Calf Raise (Bodyweight)", "muscleGroup": "Calves"},
  {"name": "Standing Calf Raise (Dumbbell)", "muscleGroup": "Calves"},
  {"name": "Standing Forearm Barbell Curls", "muscleGroup": "Biceps"},
  {"name": "Standing Jumps (Plyos)", "muscleGroup": "Cardio"},
  {"name": "Standing Single Leg Curl", "muscleGroup": "Hamstrings"},
  {"name": "Strict Lateral Raise", "muscleGroup": "Shoulders"},
  {"name": "Suitcase Carry", "muscleGroup": "Core"},
  {"name": "Suitcase Deadlift", "muscleGroup": "Quads"},
  {"name": "Suitcase Marches", "muscleGroup": "Core"},
  {"name": "T Bar Row", "muscleGroup": "Back"},
  {"name": "Toes To Bar", "muscleGroup": "Core"},
  {"name": "Trap Bar Deadlift", "muscleGroup": "Glutes"},
  {"name": "Tricep Extension - Crossboy", "muscleGroup": "Triceps"},
  {"name": "Tricep Extension Standard", "muscleGroup": "Triceps"},
  {"name": "Tricep Extension Standing", "muscleGroup": "Triceps"},
  {"name": "Tricep Pushdowns - Banded", "muscleGroup": "Triceps"},
  {"name": "Tricep pushdowns - Rope", "muscleGroup": "Triceps"},
  {"name": "Triceps Extension (Cable)", "muscleGroup": "Triceps"},
  {"name": "Triceps Pushdown (Cable - Straight Bar)", "muscleGroup": "Triceps"},
  {"name": "Walking", "muscleGroup": "Cardio"},
  {"name": "Weighted Jumps", "muscleGroup": "Cardio"},
];


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

const HI_THRESHOLD = 0.75;

function computeSessionStats(exercises) {
  let totalVolume = 0;
  let hiVolume = 0;
  for (const ex of exercises) {
    if (!ex.name) continue;
    const validSets = (ex.sets || []).filter(s => s.reps && s.reps !== "0" && s.weight);
    for (const s of validSets) {
      const reps = Math.round(parseFloat(s.reps) || 0);
      const weight = parseFloat(s.weight) || 0;
      const rir = (s.rir !== "" && s.rir !== null && s.rir !== undefined) ? parseFloat(s.rir) : 4;
      const setVol = reps * weight;
      totalVolume += setVol;
      if (weight > 0 && reps > 0) {
        for (let n = 1; n <= reps; n++) {
          const repsRemaining = (reps - n) + rir;
          const e1rm = weight * (1 + repsRemaining / 30);
          if (weight / e1rm >= HI_THRESHOLD) hiVolume += weight;
        }
      }
    }
  }
  const hiPct = totalVolume > 0 ? Math.round((hiVolume / totalVolume) * 100) : 0;
  return { totalVolume: Math.round(totalVolume), hiPct };
}

function computeDeloadScore(recentWorkouts) {
  // recentWorkouts: array of {sleepQuality, energyLevel, postRating, hiPct}
  // Returns { score, sleepScore, energyScore, sessionScore, hiPctScore, count }
  const valid = recentWorkouts.filter(w =>
    w.sleepQuality != null && w.energyLevel != null &&
    w.postRating != null && w.hiPct != null
  );
  if (valid.length < 3) return null;
  const last3 = valid.slice(-3);
  const avg = key => last3.reduce((s, w) => s + w[key], 0) / last3.length;
  const clamp = v => Math.max(0, Math.min(1, v));
  const sleepScore   = clamp((3 - avg("sleepQuality")) / 2);
  const energyScore  = clamp((3 - avg("energyLevel"))  / 2);
  const sessionScore = clamp((3 - avg("postRating"))   / 2);
  const hiPctScore   = clamp((avg("hiPct") - 50) / 50);
  const score = 0.30 * sleepScore + 0.20 * energyScore + 0.25 * sessionScore + 0.25 * hiPctScore;
  return { score, sleepScore, energyScore, sessionScore, hiPctScore, count: last3.length };
}


const inputStyle = {
  width: "100%", padding: "9px 11px", background: "var(--card)",
  border: "1.5px solid var(--border)", borderRadius: 3,
  color: "var(--ink)", fontSize: 15, fontFamily: "var(--font-body)",
  outline: "none", transition: "border-color 0.15s", WebkitAppearance: "none",
};
const inputFocusStyle = { borderColor: "var(--orange)" };
const labelStyle = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--ink3)",
  textTransform: "uppercase", marginBottom: 5, display: "block", fontFamily: "var(--font-label)",
};
const sectionLabelStyle = {
  fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", color: "var(--ink3)",
  textTransform: "uppercase", fontFamily: "var(--font-label)",
};
const btnStyle = (variant = "default") => ({
  padding: "10px 18px", borderRadius: 3, cursor: "pointer", fontSize: 13, fontWeight: 700,
  fontFamily: "var(--font-label)", letterSpacing: "0.08em", textTransform: "uppercase",
  transition: "all 0.15s", border: "none",
  ...(variant === "primary" ? { background: "var(--orange)", color: "var(--card)", boxShadow: "0 2px 0 var(--red)" }
    : variant === "danger" ? { background: "var(--red)", color: "var(--card)", boxShadow: "0 2px 0 #7a1010" }
    : variant === "ghost" ? { background: "transparent", color: "var(--ink2)", border: "1.5px solid var(--border)" }
    : variant === "active" ? { background: "var(--orange)", color: "#fff" }
    : { background: "var(--cream2)", color: "var(--ink)", border: "1.5px solid var(--border)" })
});

function StripeBar({ height = 6 }) {
  return (
    <div style={{ display: "flex", height, width: "100%" }}>
      <div style={{ flex: 3, background: "var(--orange)" }} />
      <div style={{ flex: 1, background: "var(--black)" }} />
      <div style={{ flex: 2, background: "var(--pink)" }} />
    </div>
  );
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
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: "var(--card)", border: "1.5px solid var(--orange)", borderRadius: 3, zIndex: 500, maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
          {filtered.map(opt => (
            <div key={opt} onMouseDown={() => handleSelect(opt)}
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
                      {ex.sets.length} set{ex.sets.length !== 1 ? "s" : ""} · {ex.sets.map(s => `${s.weight}lb × ${s.reps}`).join(", ")}
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
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, background: "var(--orange)" }} />
        <div style={{ flex: 0.15, background: "var(--black)" }} />
        <div style={{ flex: 0.6, background: "var(--pink)" }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: 320, width: "100%" }}>
        <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 8 }}>🏋️</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 0.9, color: "var(--orange)", letterSpacing: "0.03em", marginBottom: 24, textShadow: "3px 3px 0 var(--red)" }}>FITTRACKR</h1>
        <p style={{ color: "var(--ink3)", marginBottom: 40, fontSize: 14, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--font-label)" }}>Track every rep. Own your progress.</p>
        <button onClick={handleGoogle} disabled={loading} style={{ ...btnStyle("primary"), width: "100%", padding: "14px 24px", fontSize: 15, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", boxShadow: "0 3px 0 var(--red)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}><StripeBar height={8} /></div>
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
                <div style={{ ...sectionLabelStyle, fontSize: 11, color: "var(--orange)", marginBottom: 8 }}>{entry.date}</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 2fr 2fr", gap: 4 }}>
                  {["Set","Reps","Weight","RIR"].map(h => <div key={h} style={{ ...labelStyle, marginBottom: 2 }}>{h}</div>)}
                  {(entry.sets || []).map((set, j) => (
                    <>
                      <div key={`s${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{j + 1}</div>
                      <div key={`r${j}`} style={{ fontSize: 15, fontWeight: 600 }}>{set.reps}</div>
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
  useEffect(() => { setRemaining(restSecs); setRunning(true); }, [restSecs]);
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) { clearInterval(intervalRef.current); setRunning(false); playBeep(); vibrate(); setTimeout(() => { if (onDone) onDone(); }, 2000); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else { clearInterval(intervalRef.current); }
    return () => clearInterval(intervalRef.current);
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

function SetRow({ set, index, onChange, onRemove, defaultRestSecs, onRestChange, isActiveRest, onActivate, onRestDone, isCardio, onInteract }) {
  const fields = isCardio
    ? ["duration", "distance"]
    : ["reps", "weight", "rir"];
  const [fieldState, setFieldState] = useState(
    Object.fromEntries(fields.map(k => [k, { focused: false, typed: false }]))
  );
  function getDisplayValue(key) { const fs = fieldState[key] || {}; if (set._prefilled && fs.focused && !fs.typed) return ""; return set[key] ?? ""; }
  function getColor(key) { const fs = fieldState[key] || {}; if (!set._prefilled) return "var(--ink)"; if (fs.typed || fs.focused) return "var(--ink)"; return "var(--ink4)"; }
  function handleFocus(key) { setFieldState(prev => ({ ...prev, [key]: { focused: true, typed: false } })); }
  function handleChange(key, val) {
    if (onInteract) onInteract();
    setFieldState(prev => ({ ...prev, [key]: { ...prev[key], typed: true } }));
    const updated = { ...set, [key]: val };
    if (key === "rir" && val !== "" && val !== null && val !== undefined) onActivate();
    onChange(updated);
  }
  function handleBlur(key) {
    const fs = fieldState[key] || {};
    setFieldState(prev => ({ ...prev, [key]: { ...prev[key], focused: false } }));
    if (set._prefilled && !fs.typed) onChange({ ...set, _prefilled: false });
    if (key === "rir" && set.rir !== "" && set.rir !== null && set.rir !== undefined) onActivate();
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
    <input type="number" inputMode={mode} placeholder={placeholder}
      value={getDisplayValue(key)} onFocus={() => handleFocus(key)}
      onChange={e => handleChange(key, e.target.value)} onBlur={() => handleBlur(key)}
      style={{ ...inputStyle, textAlign: "center", color: getColor(key), fontWeight: 600, fontSize: 16, padding: "8px 4px" }}
      min={key === "rir" ? 0 : undefined} max={key === "rir" ? 10 : undefined} />
  );
  return (
    <div className="fade-in" style={{ marginBottom: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 1fr 1fr 28px", gap: 5, alignItems: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink3)", textAlign: "center", lineHeight: 1 }}>{index + 1}</div>
        {cellInput("reps", "numeric", "—")}
        {cellInput("weight", "decimal", "—")}
        {cellInput("rir", "numeric", "—")}
        <button onClick={onRemove} style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
      </div>
      {isActiveRest && <RestTimer restSecs={defaultRestSecs} defaultRestSecs={defaultRestSecs} onRestChange={onRestChange} onDone={onRestDone} />}
    </div>
  );
}

// ── Exercise Card ─────────────────────────────────────────────────────────────
function ExerciseCard({ exercise, index, onChange, onRemove, uid, library, onAddToLibrary, isActive, paused, onSetActive, onMoveUp, onMoveDown, restPrefs, onRestPrefChange, activeRestKey, onSetRestActive, activeElapsedRef, onInteract }) {
  const [showHistory, setShowHistory] = useState(false);
  const [elapsed, setElapsed] = useState(exercise.durationSec || 0);
  const intervalRef = useRef(null);
  const startRef = useRef(null);
  const accumulatedRef = useRef(exercise.durationSec || 0);
  const exerciseRef = useRef(exercise);
  const defaultRest = (exercise.name && restPrefs[exercise.name]) ? restPrefs[exercise.name] : 90;

  // Keep exerciseRef current on every render to avoid stale closure on onChange
  useEffect(() => { exerciseRef.current = exercise; });

  useEffect(() => {
    // Auto-start timer as soon as this card becomes the active one
    if (isActive && !exercise.timerStarted) {
      onChange({ ...exercise, timerStarted: true });
    }
  }, [isActive]);

  useEffect(() => {
    const shouldRun = exercise.timerStarted && isActive && !paused;
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
      // Use exerciseRef.current so we never spread a stale exercise prop
      onChange({ ...exerciseRef.current, durationSec: accumulatedRef.current });
    }
    return () => {};
  }, [exercise.timerStarted, isActive, paused]);
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

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
      const autoGroup = libraryEntry ? libraryEntry.muscleGroup : exercise.muscleGroup || "";

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
        onChange({ ...exercise, name, muscleGroup: found.muscleGroup || autoGroup, sets: lastSets.length > 0 ? lastSets : [{ weight: "", reps: "", rir: "" }] });
      } else {
        onChange({ ...exercise, name, muscleGroup: autoGroup });
      }
    } catch (e) { onChange({ ...exercise, name }); }
  }

  return (
    <div className={`fade-in stripe-accent${isActive ? " stripe-accent-active" : ""}`} onClick={onSetActive} style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderLeft: "none", borderRadius: 4, padding: "14px 14px 14px 20px", marginBottom: 10, boxShadow: isActive ? "0 2px 8px rgba(255,165,0,0.12)" : "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, marginRight: 8 }}>
          <div style={{ ...labelStyle, color: isActive ? "var(--orange)" : "var(--ink3)", marginBottom: 8 }}>Exercise {index + 1}</div>

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
                      .filter(e => e.muscleGroup === exercise.muscleGroup)
                      .map(e => e.name);
                    const filtered = all.filter(name =>
                      inGroup.some(n => n.toLowerCase() === name.toLowerCase())
                    );
                    return filtered.sort((a, b) => a.localeCompare(b));
                  })()}
                  placeholder={exercise.muscleGroup ? `${exercise.muscleGroup} exercises…` : "Select muscle group first…"}
                />
                {exercise.name && exercise.name.trim() && !(library.exercises || []).map(e => e.toLowerCase()).includes(exercise.name.trim().toLowerCase()) && (
                  <button onMouseDown={e => { e.preventDefault(); onAddToLibrary("exercises", exercise.name.trim()); }}
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
          {exercise.timerStarted && isActive && (
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: paused ? "var(--ink3)" : "var(--orange)", background: "var(--cream)", padding: "3px 8px", borderRadius: 3, letterSpacing: "0.04em", border: "1.5px solid var(--cream3)" }}>
              {paused ? "⏸ " : ""}{formatTime(elapsed)}
            </div>
          )}
          {exercise.timerStarted && !isActive && (exercise.durationSec || 0) > 0 && (
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink4)", background: "var(--cream)", padding: "3px 8px", borderRadius: 3, letterSpacing: "0.04em" }}>{formatTime(exercise.durationSec || 0)} ✓</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button onClick={e => { e.stopPropagation(); onMoveUp && onMoveUp(); }}
                disabled={!onMoveUp}
                style={{ background: "none", border: "none", color: onMoveUp ? "var(--ink3)" : "var(--cream3)", cursor: onMoveUp ? "pointer" : "default", fontSize: 14, padding: "2px 4px", lineHeight: 1 }}>▲</button>
              <button onClick={e => { e.stopPropagation(); onMoveDown && onMoveDown(); }}
                disabled={!onMoveDown}
                style={{ background: "none", border: "none", color: onMoveDown ? "var(--ink3)" : "var(--cream3)", cursor: onMoveDown ? "pointer" : "default", fontSize: 14, padding: "2px 4px", lineHeight: 1 }}>▼</button>
            </div>
            <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18 }}>🗑</button>
          </div>
        </div>
      </div>

      {exercise.sets?.length > 0 && (() => {
        const isCardio = CARDIO_MUSCLE_GROUPS.has(exercise.muscleGroup);
        return (
          <div style={{ display: "grid", gridTemplateColumns: isCardio ? "22px 1fr 1fr 28px" : "22px 1fr 1fr 1fr 28px", gap: 5, marginBottom: 4, paddingBottom: 4, borderBottom: "1.5px solid var(--cream3)" }}>
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
            isActiveRest={activeRestKey === restKey} onActivate={() => onSetRestActive(restKey)} onRestDone={() => onSetRestActive(null)}
            onInteract={onInteract} />
        );
      })}

      <button onClick={addSet} style={{ ...btnStyle("ghost"), width: "100%", marginTop: 8, fontSize: 12, color: "var(--orange)", borderColor: "var(--orange2)", borderStyle: "dashed" }}>+ Add Set</button>
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

function ActiveWorkout({ uid, user, library, onAddToLibrary, onEnd, restPrefs, onRestPrefChange, templates, onSaveTemplate, pendingTemplate }) {
  const draft = loadWorkoutDraft();

  const [workout, setWorkout] = useState(draft?.workout || { date: today(), location: "", workoutType: "", exerciseGroup: "", bodyWeight: "" });
  const [exercises, setExercises] = useState(draft?.exercises || []);
  const [totalSeconds, setTotalSeconds] = useState(draft?.totalSeconds || 0);
  const [paused, setPaused] = useState(draft ? (draft.paused ?? false) : false);
  const [workoutStarted, setWorkoutStarted] = useState(draft?.workoutStarted || false);
  const [saving, setSaving] = useState(false);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(draft?.activeExerciseIndex ?? null);
  const [activeRestKey, setActiveRestKey] = useState(null);
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
      totalTimerRef.current = setInterval(() => setTotalSeconds(s => s + 1), 1000);
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
    // Don't clear activeRestKey here — let the previous exercise's rest timer keep running
    // until the user actually starts entering data in the new exercise
    if (!workoutStarted) setWorkoutStarted(true);
  }
  function updateExercise(id, val) { setExercises(prev => prev.map(e => e.id === id ? val : e)); }
  function removeExercise(id) {
    setExercises(prev => { const next = prev.filter(e => e.id !== id); setActiveExerciseIndex(next.length > 0 ? next.length - 1 : null); return next; });
  }
  function moveExercise(i, dir) {
    setExercises(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      setActiveExerciseIndex(j);
      return next;
    });
  }

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
        sets: (ex.sets || []).filter(s => s.reps || s.weight).map(({ _prefilled, ...s }) => s),
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
      const wRef = await addDoc(collection(db, "users", uid, "workouts"), {
        date: workout.date, location: workout.location, workoutType: workout.workoutType,
        exerciseGroup: workout.exerciseGroup, totalSeconds, createdAt: serverTimestamp(),
        bodyWeight: workout.bodyWeight ? Number(workout.bodyWeight) : null,
        sleepQuality: sleepQuality || null, energyLevel: energyLevel || null,
        postRating: postRating || null,
        userName: user.displayName || null,
      });
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        if (!ex.name) continue;
        const cleanSets = ex.sets.filter(s => s.reps || s.weight).map(({ _prefilled, ...s }) => s);
        // For the currently active exercise, use the live elapsed captured via activeElapsedRef
        const durationSec = (i === activeExerciseIndex && activeElapsedRef.current > 0)
          ? activeElapsedRef.current
          : (ex.durationSec || null);
        await addDoc(collection(db, "users", uid, "workouts", wRef.id, "exercises"), {
          name: ex.name, order: i + 1, sets: cleanSets, muscleGroup: ex.muscleGroup || null,
          durationSec,
        });
        onAddToLibrary("exercises", ex.name);
      }
      clearWorkoutDraft();
      const stats = computeSessionStats(exercises);
      setSessionStats(stats);
    } catch (e) { console.error(e); alert("Error saving workout"); }
    setSaving(false);
  }

  // Show session summary after successful save
  if (sessionStats) return <SessionSummaryScreen stats={sessionStats} onDismiss={onEnd} />;

  const metaComplete = workout.date && workout.location && workout.workoutType && workout.exerciseGroup;
  const readinessComplete = sleepQuality > 0 && energyLevel > 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", paddingBottom: 100 }}>
      {/* Top bar */}
      <div style={{ background: "var(--card)", borderBottom: "1.5px solid var(--border)" }}>
        <StripeBar height={5} />
        <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1, textShadow: "1px 1px 0 var(--red)" }}>FITTRACKR</h1>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: paused ? "var(--ink3)" : "var(--ink)", letterSpacing: "0.06em", animation: paused && workoutStarted ? "pulse 1.5s infinite" : "none" }}>
              {paused && workoutStarted ? "⏸ " : ""}{formatTime(totalSeconds)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {user.photoURL && <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--orange)" }} alt="" />}
            {workoutStarted && (
              <button onClick={() => setPaused(p => !p)} style={{ ...btnStyle(paused ? "active" : "ghost"), padding: "8px 14px" }}>
                {paused ? "▶ Resume" : "⏸ Pause"}
              </button>
            )}
          </div>
        </div>
      </div>

      <DeloadBanner uid={uid} />
      <div style={{ padding: "14px 14px 0" }}>

        {/* ── Pre-workout Readiness ── */}
        <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "visible", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => readinessComplete && setReadinessDone(p => !p)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
              <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>Pre-Workout Readiness</span>
            </div>
            {readinessComplete && (
              <span style={{ color: "var(--orange)", fontSize: 12, fontFamily: "var(--font-label)", letterSpacing: "0.08em" }}>
                {readinessDone ? "▼ Edit" : `Sleep ${sleepQuality} · Energy ${energyLevel} ▲`}
              </span>
            )}
          </div>
          {!readinessDone && (
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              <ReadinessDropdown label="Sleep Quality" value={sleepQuality} onChange={setSleepQuality} />
              <ReadinessDropdown label="Energy Level" value={energyLevel} onChange={setEnergyLevel} />
              {readinessComplete && (
                <button onClick={() => setReadinessDone(true)} style={{ ...btnStyle("primary"), width: "100%", padding: "10px" }}>
                  Confirm Readiness
                </button>
              )}
            </div>
          )}
        </div>

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
                <ComboBox value={workout.workoutType} onChange={val => setWorkout(w => ({ ...w, workoutType: val }))} onCommit={val => onAddToLibrary("workoutTypes", val)} options={library.workoutTypes || ["Hypertrophy", "Strength", "Power", "Cardio", "Recovery"]} placeholder="Type…" />
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

        {exercises.map((ex, i) => (
          <ExerciseCard key={ex.id} exercise={ex} index={i}
            onChange={val => updateExercise(ex.id, val)} onRemove={() => removeExercise(ex.id)}
            uid={uid} library={library} onAddToLibrary={onAddToLibrary}
            isActive={activeExerciseIndex === i} paused={paused} activeElapsedRef={activeElapsedRef}
            onInteract={() => setActiveRestKey(null)}
            onSetActive={() => setActiveExerciseIndex(i)}
            onMoveUp={i > 0 ? () => moveExercise(i, -1) : null}
            onMoveDown={i < exercises.length - 1 ? () => moveExercise(i, 1) : null}
            restPrefs={restPrefs} onRestPrefChange={onRestPrefChange}
            activeRestKey={activeRestKey} onSetRestActive={setActiveRestKey} />
        ))}

        <button onClick={addExercise} disabled={!metaComplete} style={{ ...btnStyle("primary"), width: "100%", padding: "14px", fontSize: 16, opacity: metaComplete ? 1 : 0.45, boxShadow: metaComplete ? "0 3px 0 var(--red)" : "none" }}>
          {metaComplete ? "+ Add Exercise" : "Fill session details first"}
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
              <p style={{ color: "var(--ink3)", fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>Rate your session before saving.</p>

              {/* Star rating */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ ...labelStyle, marginBottom: 10 }}>Session Rating</label>
                <StarRating value={postRating} onChange={setPostRating} size={36} />
              </div>

              {/* Save as template */}
              <div style={{ marginBottom: 24, padding: 14, background: "var(--cream)", borderRadius: 4, border: "1.5px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: saveAsTemplate ? 12 : 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>Save as Template?</label>
                  <div onClick={() => setSaveAsTemplate(p => !p)} style={{ width: 44, height: 24, borderRadius: 12, background: saveAsTemplate ? "var(--orange)" : "var(--cream3)", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
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

  async function handleSave() {
    setSaving(true);
    try {
      for (const ex of exercises) {
        const cleanSets = ex.sets.filter(s => s.reps || s.weight || s.duration || s.distance)
          .map(({ _prefilled, ...s }) => s);
        await setDoc(doc(db, "users", uid, "workouts", workout.id, "exercises", ex.id),
          { name: ex.name, muscleGroup: ex.muscleGroup || null, order: ex.order || 0, sets: cleanSets },
          { merge: true }
        );
      }
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
              <div style={{ display: "grid", gridTemplateColumns: isCardio(ex) ? "22px 1fr 1fr 28px" : "22px 1fr 1fr 1fr 28px", gap: 5, marginBottom: 4 }}>
                <div />
                {isCardio(ex) ? (
                  <><div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Duration</div>
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Dist (mi)</div></>
                ) : (
                  <><div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Reps</div>
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>Weight</div>
                  <div style={{ ...labelStyle, textAlign: "center", marginBottom: 0 }}>RIR</div></>
                )}
                <div />
              </div>
              {/* Sets */}
              {ex.sets.map((set, setIdx) => (
                <div key={setIdx} style={{ display: "grid", gridTemplateColumns: isCardio(ex) ? "22px 1fr 1fr 28px" : "22px 1fr 1fr 1fr 28px", gap: 5, marginBottom: 5, alignItems: "center" }}>
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
                      <input type="number" value={set.rir !== undefined && set.rir !== null ? set.rir : ""} onChange={e => updateSet(exIdx, setIdx, "rir", e.target.value)}
                        style={{ ...inputStyle, textAlign: "center", fontWeight: 600, fontSize: 15, padding: "7px 4px" }} placeholder="—" min={0} max={10} />
                    </>
                  )}
                  <button onClick={() => removeSet(exIdx, setIdx)}
                    style={{ background: "none", border: "none", color: "var(--ink4)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}
              <button onClick={() => addSet(exIdx)}
                style={{ ...btnStyle("ghost"), width: "100%", marginTop: 6, fontSize: 12, color: "var(--orange)", borderColor: "var(--orange2)", borderStyle: "dashed" }}>+ Add Set</button>
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
        // Fetch last 10 workouts (enough to find 3 with all fields)
        const wSnap = await getDocs(query(collection(db, "users", uid, "workouts"), orderBy("date", "desc")));
        const docs = wSnap.docs.slice(0, 10);

        // Check if most recent workout is within 14 days
        if (!docs.length) return;
        const mostRecentDate = new Date(docs[0].data().date + "T00:00:00");
        const daysSince = (Date.now() - mostRecentDate) / 86400000;
        if (daysSince > 14) return;

        // Build workout rows with hiPct computed from exercises
        const rows = await Promise.all(docs.map(async wDoc => {
          const w = wDoc.data();
          const eSnap = await getDocs(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          let totalVol = 0, hiVol = 0;
          for (const eDoc of eSnap.docs) {
            const ex = eDoc.data();
            for (const s of (ex.sets || [])) {
              const reps = Math.round(parseFloat(s.reps) || 0);
              const weight = parseFloat(s.weight) || 0;
              const rir = (s.rir !== "" && s.rir !== null && s.rir !== undefined) ? parseFloat(s.rir) : 4;
              totalVol += reps * weight;
              if (weight > 0 && reps > 0) {
                for (let n = 1; n <= reps; n++) {
                  const rr = (reps - n) + rir;
                  const e1rm = weight * (1 + rr / 30);
                  if (weight / e1rm >= HI_THRESHOLD) hiVol += weight;
                }
              }
            }
          }
          return {
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
  const bg = isRed ? "rgba(192,37,26,0.08)" : "rgba(255,165,0,0.10)";
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
        const docs = wSnap.docs.slice(0, 10);
        if (!docs.length) { setInsufficient(true); return; }

        const mostRecentDate = new Date(docs[0].data().date + "T00:00:00");
        const daysSince = (Date.now() - mostRecentDate) / 86400000;
        if (daysSince > 14) { setInsufficient(true); return; }

        const rows = await Promise.all(docs.map(async wDoc => {
          const w = wDoc.data();
          const eSnap = await getDocsFromServer(collection(db, "users", uid, "workouts", wDoc.id, "exercises"));
          let totalVol = 0, hiVol = 0;
          for (const eDoc of eSnap.docs) {
            const ex = eDoc.data();
            for (const s of (ex.sets || [])) {
              const reps = Math.round(parseFloat(s.reps) || 0);
              const weight = parseFloat(s.weight) || 0;
              const rir = (s.rir !== "" && s.rir !== null && s.rir !== undefined) ? parseFloat(s.rir) : 4;
              totalVol += reps * weight;
              if (weight > 0 && reps > 0) {
                for (let n = 1; n <= reps; n++) {
                  const rr = (reps - n) + rir;
                  const e1rm = weight * (1 + rr / 30);
                  if (weight / e1rm >= HI_THRESHOLD) hiVol += weight;
                }
              }
            }
          }
          return {
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
    if (score >= 80) return { label: "Optimal",     color: "var(--green)" };
    if (score >= 60) return { label: "Good",        color: "var(--green)" };
    if (score >= 40) return { label: "Moderate",    color: "var(--orange)" };
    if (score >= 20) return { label: "Fatigued",    color: "var(--red)" };
    return              { label: "Overreached",  color: "var(--red)" };
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
          const { label, color } = getStatus(score);
          return (
            <>
              {/* Score + label */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 64, color, lineHeight: 1, letterSpacing: "0.02em" }}>{score}</span>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color, letterSpacing: "0.04em", lineHeight: 1 }}>{label}</div>
                  <div style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", letterSpacing: "0.06em", marginTop: 2 }}>out of 100</div>
                </div>
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
                Based on your 3 most recent sessions
              </div>
            </>
          );
        })()}
      </div>
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
    const parts = [w.workoutType, w.exerciseGroup, w.location].filter(Boolean);
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
          {expanded === w.id && <div style={{ height: 3, background: "linear-gradient(to right, var(--orange), var(--pink))" }} />}
          {expanded === w.id && exercises[w.id] && (
            <div style={{ padding: "12px 16px", background: "var(--cream)" }}>
              {exercises[w.id].map((ex, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--orange)", letterSpacing: "0.04em" }}>{ex.name.toUpperCase()}</div>
                    {ex.muscleGroup && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-label)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ex.muscleGroup}</span>}
                    {ex.durationSec > 0 && <span style={{ fontSize: 11, color: "var(--ink4)", fontFamily: "var(--font-display)", letterSpacing: "0.06em" }}>⏱ {formatTime(ex.durationSec)}</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, marginBottom: 4 }}>
                    {["","Reps","Weight","RIR"].map((h, i) => <div key={i} style={{ ...labelStyle, textAlign: i > 0 ? "center" : "left", marginBottom: 0 }}>{h}</div>)}
                  </div>
                  {(ex.sets || []).map((set, j) => (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr", gap: 4, marginBottom: 4, padding: "4px 0", borderBottom: "1px solid var(--cream3)" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink3)" }}>{j + 1}</div>
                      <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.reps}</div>
                      <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.weight}<span style={{ color: "var(--ink4)", fontSize: 11 }}>lb</span></div>
                      <div style={{ textAlign: "center", fontWeight: 600, fontSize: 15 }}>{set.rir !== "" && set.rir != null ? set.rir : "—"}</div>
                    </div>
                  ))}
                </div>
              ))}
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
              <div style={{ height: 3, background: "linear-gradient(to right, var(--orange), var(--pink))" }} />
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
                        <div style={{ textAlign: "center", fontWeight: 600, fontSize: 14 }}>{s.reps}</div>
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

function BottomNav({ tab, setTab, onNewWorkout }) {
  const items = [{ id: "log", icon: "➕", label: "Log" }, { id: "history", icon: "📅", label: "History" }, { id: "templates", icon: "📋", label: "Templates" }, { id: "analytics", icon: "📊", label: "Analytics" }, { id: "profile", icon: "👤", label: "Profile" }];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--card)", borderTop: "1.5px solid var(--border)", zIndex: 100 }}>
      <div style={{ display: "flex" }}>
        {items.map(item => (
          <button key={item.id} onClick={() => item.id === "log" ? onNewWorkout() : setTab(item.id)}
            style={{ flex: 1, padding: "11px 0", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: tab === item.id ? "var(--orange)" : "var(--ink3)", transition: "color 0.15s", borderTop: tab === item.id ? "2.5px solid var(--orange)" : "2.5px solid transparent" }}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--font-label)" }}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen({ user, onSeedLibrary, onImportStrong }) {
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
              muscleGroup: libEntry ? libEntry.muscleGroup : '',
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
            {user.photoURL && <img src={user.photoURL} style={{ width: 52, height: 52, borderRadius: "50%", border: "2.5px solid var(--orange)" }} alt="" />}
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
    </div>
  );
}

function AnalyticsScreen({ uid }) {
  const REPORTS = [
    { id: "sets",    label: "Sets Per Week",    desc: "Total sets by muscle group per week" },
    { id: "volume",  label: "Volume Per Week",  desc: "Total volume with high-intensity portion (≥75% e1RM) stacked, plus hi% line" },
  ];

  const [report, setReport]         = useState(null); // null = not yet run
  const [selectedReport, setSelectedReport] = useState("sets");
  const [running, setRunning]       = useState(false);
  const [allData, setAllData]       = useState(null); // loaded once, reused across reports
  const [muscleGroup, setMuscleGroup] = useState("All");
  const [range, setRange]           = useState("26");

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
            const validSets = (ex.sets || []).filter(s => s.reps && s.reps !== "0");
            if (!validSets.length) continue;

            // High-intensity volume: count reps × weight only for reps where
            // effective % 1RM ≥ 75%. As fatigue accumulates within a set, each
            // successive rep is at a higher % of 1RM. For rep N of a set:
            //   reps_remaining = (total_reps - N) + RIR
            //   effective_e1RM = weight × (1 + reps_remaining / 30)  [Epley]
            //   effective_pct  = weight / effective_e1RM
            // If effective_pct ≥ 0.75, that rep counts toward hiVolume.
            const HI_THRESHOLD = 0.75;
            let hiVolume = 0;
            for (const s of validSets) {
              const reps = Math.round(parseFloat(s.reps) || 0);
              const weight = parseFloat(s.weight) || 0;
              const rir = s.rir !== "" && s.rir !== null && s.rir !== undefined ? parseFloat(s.rir) : 4;
              if (weight > 0 && reps > 0) {
                for (let n = 1; n <= reps; n++) {
                  const repsRemaining = (reps - n) + rir;
                  const effectiveE1rm = weight * (1 + repsRemaining / 30);
                  const effectivePct = weight / effectiveE1rm;
                  if (effectivePct >= HI_THRESHOLD) hiVolume += weight;
                }
              }
            }
            rows.push({
              date: wDate,
              muscleGroup: ex.muscleGroup,
              sets: validSets.length,
              volume: validSets.reduce((sum, s) => sum + (parseFloat(s.reps) || 0) * (parseFloat(s.weight) || 0), 0),
              hiVolume,
            });
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

  async function runReport() {
    setRunning(true);
    let data = allData;
    if (!data) data = await loadData();
    console.log("Report data rows:", data?.length);
    setReport({ type: selectedReport, data: data || [] });
    setRunning(false);
  }

  function weekStart(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }
  function addWeeks(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n * 7);
    return d.toISOString().slice(0, 10);
  }
  function formatWeekLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  const chartData = useMemo(() => {
    if (!report?.data) return [];
    const isVolume = report.type === "volume";
    const metric = isVolume ? "volume" : "sets";
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

    const volMap = new Map();
    const hiMap = new Map();
    for (const row of filtered) {
      const ws = weekStart(row.date);
      if (ws < startWeek) continue;
      volMap.set(ws, (volMap.get(ws) || 0) + row[metric]);
      if (isVolume) hiMap.set(ws, (hiMap.get(ws) || 0) + (row.hiVolume || 0));
    }

    const weeks = [];
    let cur = startWeek;
    while (cur <= thisWeek) {
      const entry = { week: cur, value: volMap.get(cur) || 0, label: formatWeekLabel(cur) };
      if (isVolume) entry.hi = hiMap.get(cur) || 0;
      weeks.push(entry);
      cur = addWeeks(cur, 1);
    }
    return weeks;
  }, [report, muscleGroup, range]);

  const availableGroups = useMemo(() => {
    if (!report?.data) return ["All", ...MUSCLE_GROUPS];
    return ["All", ...[...new Set(report.data.map(r => r.muscleGroup))].sort()];
  }, [report]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const nonZero = chartData.filter(d => d.value > 0);
    if (!nonZero.length) return null;
    const total = nonZero.reduce((s, d) => s + d.value, 0);
    const isVol = report?.type === "volume";
    const avg = (total / chartData.length).toFixed(isVol ? 0 : 1);
    const peak = Math.max(...nonZero.map(d => d.value));
    return { avg, peak: isVol ? Math.round(peak).toLocaleString() : peak, weeks: nonZero.length };
  }, [chartData, report]);

  function formatValue(v) {
    if (report?.type === "volume") return Math.round(v).toLocaleString();
    return v;
  }

  function BarChart({ data }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(340);
    const [tooltip, setTooltip] = useState(null);

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

    // Linear regression trend line
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

    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        {showTrend && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontFamily: "var(--font-label)", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: trendColor,
              background: rising ? "rgba(26,122,58,0.10)" : falling ? "rgba(192,37,26,0.10)" : "rgba(0,0,0,0.06)",
              padding: "3px 8px", borderRadius: 3,
            }}>
              {trendArrow} {trendLabel}
            </span>
          </div>
        )}
        <svg width={W} height={H} style={{ display: "block", width: "100%", fontFamily: "var(--font-label)" }}
          onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTimeout(() => setTooltip(null), 1800)}>

          {yTicks.map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={py(v)} y2={py(v)} stroke="var(--cream3)" strokeWidth={1} />
              <text x={padL - 4} y={py(v) + 4} textAnchor="end" fill="var(--ink4)" fontSize={9}>{formatYTick(v)}</text>
            </g>
          ))}

          {data.map((d, i) => {
            const h = bh(d.value);
            const isHovered = tooltip?.i === i;
            return (
              <g key={i} onMouseEnter={() => setTooltip({ i, d })} onTouchStart={() => setTooltip({ i, d })}>
                <rect x={bx(i) - slotW / 2} y={padT} width={slotW} height={chartH} fill="transparent" />
                {h > 0 && (
                  <rect x={bx(i) - barW / 2} y={py(d.value)} width={barW} height={h} rx={2}
                    fill={isHovered ? "var(--orange2)" : "var(--orange)"}
                    opacity={isHovered ? 1 : 0.85} />
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
            const y = py(tooltip.d.value) - 6;
            const flip = x > W * 0.65;
            const label = `${formatValue(tooltip.d.value)} · ${tooltip.d.label}`;
            const boxW = Math.min(label.length * 7 + 16, 150);
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

  const isVolume = report?.type === "volume";
  const statLabels = isVolume
    ? ["Avg Vol/Wk", "Peak Week", "Active Weeks"]
    : ["Avg Sets/Wk", "Peak Week", "Active Weeks"];

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <TrainingReadinessCard uid={uid} />
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

      {/* Chart card — only shown after report runs */}
      {report && (
        <div style={{ background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ background: "var(--black)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 4, height: 16, background: "var(--orange)", borderRadius: 2 }} />
            <span style={{ ...sectionLabelStyle, color: "var(--card)", fontSize: 11 }}>
              {REPORTS.find(r => r.id === report.type)?.label}
            </span>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 4 }}>Muscle Group</label>
                <select value={muscleGroup} onChange={e => setMuscleGroup(e.target.value)}
                  style={{ ...inputStyle, fontSize: 14, padding: "8px 10px" }}>
                  {availableGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
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
            {report.type === "volume" ? <VolumeLineChart data={chartData} /> : <BarChart data={chartData} />}
            {stats && (
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
    locations: [], workoutTypes: ["Hypertrophy", "Strength", "Power", "Cardio", "Recovery"],
    exerciseGroups: ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"], exercises: []
  });
  const [restPrefs, setRestPrefs] = useState({});
  const [templates, setTemplates] = useState([]);

  useEffect(() => onAuthStateChanged(auth, u => setUser(u || null)), []);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "meta", "library");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const data = snap.data();
        setLibrary(prev => ({ ...prev, ...data }));
        if (data.restPrefs) setRestPrefs(data.restPrefs);
      } else {
        // First login — seed the exercise library
        const exerciseNames = EXERCISE_LIBRARY.map(e => e.name);
        const muscleGroupMap = Object.fromEntries(EXERCISE_LIBRARY.map(e => [e.name, e.muscleGroup]));
        const seedData = {
          exercises: exerciseNames,
          muscleGroups: muscleGroupMap,
          locations: [],
          workoutTypes: ["Hypertrophy", "Strength", "Power", "Cardio", "Recovery"],
          exerciseGroups: ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"],
          restPrefs: {},
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
    const exerciseNames = EXERCISE_LIBRARY.map(e => e.name);
    const ref = doc(db, "users", user.uid, "meta", "library");
    // Merge with existing — don't overwrite custom exercises
    setLibrary(prev => {
      const existing = prev.exercises || [];
      const merged = [...new Set([...exerciseNames, ...existing])];
      const updated = { ...prev, exercises: merged };
      setDoc(ref, { exercises: merged }, { merge: true }).catch(console.error);
      return updated;
    });
  }, [user]);

  const addToLibrary = useCallback(async (key, value) => {
    if (!user || !value || !value.trim()) return;
    const trimmed = value.trim();
    setLibrary(prev => {
      const list = prev[key] || [];
      if (list.map(i => i.toLowerCase()).includes(trimmed.toLowerCase())) return prev;
      const updated = { ...prev, [key]: [...list, trimmed] };
      setDoc(doc(db, "users", user.uid, "meta", "library"), { [key]: updated[key] }, { merge: true }).catch(console.error);
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
      <div style={{ fontFamily: "var(--font-display)", fontSize: 36, color: "var(--orange)", letterSpacing: "0.06em", animation: "pulse 1.5s infinite" }}>FITTRACKR</div>
    </div>
  );

  if (!user) return <SignIn />;

  if (logging) return (
    <ActiveWorkout uid={user.uid} user={user} library={library} onAddToLibrary={addToLibrary}
      onEnd={() => { clearWorkoutDraft(); setLogging(false); setPendingTemplate(null); setTab("history"); }}
      restPrefs={restPrefs} onRestPrefChange={updateRestPref}
      templates={templates} onSaveTemplate={() => {}}
      pendingTemplate={pendingTemplate} />
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", paddingBottom: 70 }}>
      <div style={{ background: "var(--card)", borderBottom: "1.5px solid var(--border)" }}>
        <StripeBar height={5} />
        <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, color: "var(--orange)", letterSpacing: "0.04em", lineHeight: 1, textShadow: "1px 1px 0 var(--red)" }}>FITTRACKR</h1>
            <div style={{ ...sectionLabelStyle, fontSize: 10, color: "var(--ink3)", marginTop: 1 }}>
              {tab === "history" ? "Training History" : tab === "analytics" ? "Analytics" : tab === "templates" ? "Templates" : "Profile"}
            </div>
          </div>
          {user.photoURL && <img src={user.photoURL} style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--orange)" }} alt="" />}
        </div>
      </div>
      {tab === "history" && <HistoryScreen uid={user.uid} />}
      {tab === "analytics" && <AnalyticsScreen key={analyticsKey} uid={user.uid} />}
      {tab === "templates" && <TemplatesScreen uid={user.uid} templates={templates} onStartWorkout={t => { startFromTemplate(t); }} />}
      {tab === "profile" && <ProfileScreen user={user} onSeedLibrary={seedLibrary} />}
      <BottomNav tab={tab} setTab={t => { if (t === "analytics") setAnalyticsKey(k => k + 1); setTab(t); }} onNewWorkout={() => setLogging(true)} />
    </div>
  );
}
