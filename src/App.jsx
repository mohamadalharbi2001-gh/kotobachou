import { useState, useEffect, useRef } from "react";
import { ChevronLeft, Trash2, LogOut } from "lucide-react";
import { signUp, signIn, refreshSession, signOutRemote, getNotebook, saveNotebook } from "./supabaseClient";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const SESSION_KEY = "kotobachou-session";
const EMPTY_NOTES = { vocab: [], grammar: [], examples: [], progress: {} };

const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Maru+Gothic:wght@400;500;700&display=swap');
  .kb-app {
    --paper: #EDE7D6;
    --paper-line: #C9C0A0;
    --ink: #24211D;
    --ink-soft: #5B5648;
    --indigo: #2A3F5C;
    --indigo-deep: #1B2C42;
    --shu: #B7410E;
    min-height: 100vh;
    background-color: var(--paper);
    background-image:
      linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px);
    background-size: 28px 28px;
    font-family: 'Zen Maru Gothic', sans-serif;
    color: var(--ink);
    padding: 20px 16px 60px;
  }
  .kb-app *:focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }
  .kb-wordmark { font-family: 'Shippori Mincho', serif; font-size: 40px; font-weight: 700; letter-spacing: 0.05em; line-height: 1; }
  .kb-sub { font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--ink-soft); margin-top: 4px; }
  .kb-nav { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
  .kb-cell { width: 76px; height: 76px; border: 1.5px solid var(--ink); background: var(--paper); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; transition: background 0.15s ease, transform 0.15s ease; }
  .kb-cell:hover { background: rgba(42,63,92,0.08); }
  .kb-cell:active { transform: translateY(1px); }
  .kb-cell-glyph { font-family: 'Shippori Mincho', serif; font-size: 26px; }
  .kb-cell-label { font-size: 10px; color: var(--ink-soft); text-align: center; }
  .kb-card { background: rgba(255,255,255,0.35); border: 1px solid var(--paper-line); padding: 16px; }
  .kb-btn { font-family: 'Zen Maru Gothic', sans-serif; background: var(--indigo); color: var(--paper); border: none; padding: 10px 18px; font-size: 14px; cursor: pointer; transition: background 0.15s ease; }
  .kb-btn:hover { background: var(--indigo-deep); }
  .kb-btn:disabled { opacity: 0.5; cursor: default; }
  .kb-btn.secondary { background: transparent; color: var(--ink); border: 1px solid var(--ink); }
  .kb-btn.danger { background: var(--shu); }
  .kb-back { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--ink-soft); cursor: pointer; font-size: 13px; padding: 4px 0; }
  .kb-input, .kb-textarea { font-family: 'Zen Maru Gothic', sans-serif; background: rgba(255,255,255,0.5); border: 1px solid var(--ink); padding: 10px; width: 100%; font-size: 14px; color: var(--ink); box-sizing: border-box; }
  .kb-topic-header { font-family: 'Shippori Mincho', serif; font-size: 18px; margin: 20px 0 8px; border-bottom: 1px solid var(--ink); padding-bottom: 4px; }
  .kb-item-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--paper-line); }
`;

function normalize(s) {
  return (s || "").trim().toLowerCase();
}

function stripFences(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function pdfToPageImages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
  }
  return images;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function pickN(arr, n, exclude) {
  const pool = arr.filter(function (item) { return item !== exclude; });
  return shuffle(pool).slice(0, n);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BOX_INTERVALS = [2 * 60 * 1000, DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS, 90 * DAY_MS];

function nextRecord(rec, correct) {
  const now = Date.now();
  const prev = rec || { box: 0, right: 0, wrong: 0 };
  const box = correct ? Math.min(prev.box + 1, BOX_INTERVALS.length - 1) : 0;
  return {
    box: box,
    right: prev.right + (correct ? 1 : 0),
    wrong: prev.wrong + (correct ? 0 : 1),
    last: now,
    due: now + BOX_INTERVALS[box]
  };
}

function pickNext(items, progress, avoidKey) {
  const now = Date.now();
  const due = [];
  const fresh = [];
  const later = [];
  items.forEach(function (item) {
    if (item.key === avoidKey) return;
    const rec = progress[item.key];
    if (!rec) fresh.push(item);
    else if (rec.due <= now) due.push(item);
    else later.push(item);
  });
  due.sort(function (a, b) { return progress[a.key].due - progress[b.key].due; });
  const randomOf = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  if (later.length && Math.random() < 0.1) return randomOf(later);
  if (due.length && (Math.random() < 0.75 || !fresh.length)) return randomOf(due.slice(0, 3));
  if (fresh.length) return randomOf(fresh);
  const rest = due.concat(later);
  if (rest.length) return randomOf(rest);
  return randomOf(items);
}

function progressStats(items, progress) {
  const now = Date.now();
  const stats = { due: 0, fresh: 0, learning: 0, known: 0 };
  items.forEach(function (item) {
    const rec = progress[item.key];
    if (!rec) stats.fresh += 1;
    else if (rec.due <= now) stats.due += 1;
    else if (rec.box <= 2) stats.learning += 1;
    else stats.known += 1;
  });
  return stats;
}

async function callClaude(system, content, maxTokens) {
  const response = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: system, content: content, max_tokens: maxTokens || 4096 })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error("The AI request failed (status " + response.status + "). " + (data.error ? JSON.stringify(data.error) : ""));
  }
  const text = (data.content || [])
    .filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; })
    .join("\n");
  return text;
}

const SYSTEM_ORGANIZE = `You are a careful Japanese study assistant helping a student build a personal notebook.
You will receive a photo, PDF, or typed text of the student's lesson notes, plus a list of items they have already saved.
Pull out ONLY items that are NOT already in the saved list (treat something as already saved if the Japanese word or grammar pattern matches, even if the reading or English wording differs slightly).
Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"vocab":[{"japanese":"","reading":"","meaning":"","topic":""}],"grammar":[{"point":"","explanation":"","example_ja":"","example_en":""}],"examples":[{"japanese":"","translation":""}],"has_more":false}
Keep meaning and explanation under 10 words each. Choose a short natural topic for each vocab word (such as Verbs, Greetings, Food, Adjectives, Numbers, Travel, Family, Time) or invent a short one if nothing fits. If a category has nothing new, return an empty array for it.
Include AT MOST 15 new vocabulary items, 5 new grammar points, and 5 new example sentences per response, even if the notes contain more. Work through the notes in the order they appear (top of the file first). If you stopped early because of these limits, set "has_more" to true; otherwise set it to false. Never end your JSON in the middle of an item or with unclosed brackets.
Some pages may contain nothing but a bare number or date stamp (for example a page that just says "0507"), left over from when this was separate Google Doc tabs exported together into one file. These are not lesson content — ignore them entirely.`;

const SYSTEM_EXPLAIN = `You are an encouraging Japanese teacher. Given one saved item from a student's notebook, give a deeper plain-English explanation: nuance, when to use it, common mistakes, and one or two extra example sentences with translations. Plain text only, under 180 words, no markdown headers.`;

export default function App() {
  const [session, setSessionState] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(function () {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        setSessionState(JSON.parse(raw));
      } catch (e) {
        // ignore bad saved session
      }
    }
    setChecking(false);
  }, []);

  function handleAuthed(sess) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    setSessionState(sess);
  }

  function handleLogout() {
    if (session) signOutRemote(session.access_token);
    localStorage.removeItem(SESSION_KEY);
    setSessionState(null);
  }

  if (checking) return null;
  if (!session) return <AuthView onAuthed={handleAuthed} />;
  return <MainApp session={session} onSessionUpdate={handleAuthed} onLogout={handleLogout} />;
}

function AuthView({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const data = await signUp(email, password);
        if (data.access_token) {
          onAuthed({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
        } else {
          setInfo("Account created. Check your email to confirm it, then log in.");
          setMode("login");
        }
      } else {
        const data = await signIn(email, password);
        onAuthed({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kb-app">
      <style>{GLOBAL_STYLE}</style>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 60 }}>
        <div className="kb-wordmark">言葉帳</div>
        <div className="kb-sub">kotobachō — your japanese notebook</div>

        <div style={{ marginTop: 32 }}>
          <p style={{ fontSize: 14, marginBottom: 6 }}>Email</p>
          <input className="kb-input" type="email" value={email} onChange={function (e) { setEmail(e.target.value); }} />

          <p style={{ fontSize: 14, margin: "14px 0 6px" }}>Password</p>
          <input
            className="kb-input"
            type="password"
            value={password}
            onChange={function (e) { setPassword(e.target.value); }}
            onKeyDown={function (e) { if (e.key === "Enter") handleSubmit(); }}
          />

          <button className="kb-btn" style={{ marginTop: 18 }} onClick={handleSubmit} disabled={busy || !email || !password}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
          </button>

          {error && <p style={{ color: "var(--shu)", marginTop: 12 }}>{error}</p>}
          {info && <p style={{ color: "var(--indigo)", marginTop: 12 }}>{info}</p>}

          <p style={{ marginTop: 18, fontSize: 13 }}>
            {mode === "signup" ? "Already have an account? " : "New here? "}
            <button
              className="kb-back"
              style={{ padding: 0, display: "inline", textDecoration: "underline" }}
              onClick={function () { setMode(mode === "signup" ? "login" : "signup"); setError(null); setInfo(null); }}
            >
              {mode === "signup" ? "Log in" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function MainApp({ session, onSessionUpdate, onLogout }) {
  const [view, setView] = useState("home");
  const [notes, setNotes] = useState(EMPTY_NOTES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const saveTimer = useRef(null);

  useEffect(function () {
    (async function () {
      setLoading(true);
      try {
        const data = await withFreshToken(function (token) { return getNotebook(token, sessionRef.current.user.id); });
        if (data) {
          setNotes({ vocab: data.vocab || [], grammar: data.grammar || [], examples: data.examples || [], progress: data.progress || {} });
        }
      } catch (err) {
        setLoadError(err.message || "Could not load your notebook.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  async function withFreshToken(fn) {
    try {
      return await fn(sessionRef.current.access_token);
    } catch (err) {
      if (err && err.status === 401) {
        try {
          const refreshed = await refreshSession(sessionRef.current.refresh_token);
          const updated = Object.assign({}, sessionRef.current, {
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token
          });
          sessionRef.current = updated;
          onSessionUpdate(updated);
          return await fn(updated.access_token);
        } catch (e2) {
          onLogout();
          throw new Error("Your session expired. Please log in again.");
        }
      }
      throw err;
    }
  }

  async function persist(nextNotes) {
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    try {
      await withFreshToken(function (token) { return saveNotebook(token, sessionRef.current.user.id, nextNotes); });
    } catch (err) {
      setLoadError(err.message || "Could not save your notebook just now.");
    }
  }

  async function flushProgress() {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    try {
      await withFreshToken(function (token) { return saveNotebook(token, sessionRef.current.user.id, notesRef.current); });
    } catch (err) {
      setLoadError(err.message || "Could not save your progress just now.");
    }
  }

  function recordAnswer(key, correct) {
    const prev = notesRef.current;
    const nextProgress = Object.assign({}, prev.progress, { [key]: nextRecord(prev.progress[key], correct) });
    const next = Object.assign({}, prev, { progress: nextProgress });
    notesRef.current = next;
    setNotes(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushProgress, 2000);
  }

  useEffect(function () {
    flushProgress();
    // eslint-disable-next-line
  }, [view]);

  useEffect(function () {
    function onHide() { if (document.visibilityState === "hidden") flushProgress(); }
    document.addEventListener("visibilitychange", onHide);
    return function () { document.removeEventListener("visibilitychange", onHide); };
    // eslint-disable-next-line
  }, []);

  async function handleLogout() {
    await flushProgress();
    onLogout();
  }

  const totalItems = notes.vocab.length + notes.grammar.length + notes.examples.length;
  const dueCount = Object.keys(notes.progress).filter(function (k) { return notes.progress[k].due <= Date.now(); }).length;

  return (
    <div className="kb-app">
      <style>{GLOBAL_STYLE}</style>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {view !== "home" ? (
            <button className="kb-back" onClick={function () { setView("home"); }}>
              <ChevronLeft size={16} /> Back
            </button>
          ) : <span />}
          <button className="kb-back" onClick={handleLogout}>
            <LogOut size={14} /> Log out
          </button>
        </div>

        {view === "home" && (
          <>
            <div className="kb-wordmark">言葉帳</div>
            <div className="kb-sub">kotobachō — your japanese notebook</div>

            {loading ? (
              <p style={{ marginTop: 24 }}>Loading your notebook…</p>
            ) : (
              <>
                <p style={{ marginTop: 20, color: "var(--ink-soft)" }}>
                  {totalItems === 0
                    ? "Your notebook is empty. Upload your first lesson to get started."
                    : notes.vocab.length + " words, " + notes.grammar.length + " grammar points, " + notes.examples.length + " example sentences saved."}
                </p>
                {dueCount > 0 && (
                  <p style={{ marginTop: 6, color: "var(--shu)" }}>
                    {dueCount} item{dueCount === 1 ? "" : "s"} due for review — open Quiz to go through {dueCount === 1 ? "it" : "them"}.
                  </p>
                )}
                <div className="kb-nav">
                  <button className="kb-cell" onClick={function () { setView("upload"); }}>
                    <span className="kb-cell-glyph">書</span>
                    <span className="kb-cell-label">Add notes</span>
                  </button>
                  <button className="kb-cell" onClick={function () { setView("browse"); }}>
                    <span className="kb-cell-glyph">単</span>
                    <span className="kb-cell-label">Browse</span>
                  </button>
                  <button className="kb-cell" onClick={function () { setView("export"); }}>
                    <span className="kb-cell-glyph">蔵</span>
                    <span className="kb-cell-label">Back up</span>
                  </button>
                  <button className="kb-cell" onClick={function () { setView("practice"); }}>
                    <span className="kb-cell-glyph">練</span>
                    <span className="kb-cell-label">Practice</span>
                  </button>
                  <button className="kb-cell" onClick={function () { setView("quiz"); }}>
                    <span className="kb-cell-glyph">験</span>
                    <span className="kb-cell-label">Quiz</span>
                  </button>
                </div>
              </>
            )}
            {loadError && <p style={{ color: "var(--shu)", marginTop: 16 }}>{loadError}</p>}
          </>
        )}

        {view === "upload" && <UploadView notes={notes} onSaved={persist} />}
        {view === "browse" && <BrowseView notes={notes} onChange={persist} />}
        {view === "export" && <ExportView notes={notes} onClear={function () { return persist(EMPTY_NOTES); }} />}
        {view === "practice" && <PracticeView progress={notes.progress} onAnswer={recordAnswer} />}
        {view === "quiz" && <QuizView notes={notes} onAnswer={recordAnswer} />}
      </div>
    </div>
  );
}

function UploadView({ notes, onSaved }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  function toggleSelect(section, idx) {
    setPreview(function (p) {
      const nextArr = p[section].map(function (it, i) {
        return i === idx ? Object.assign({}, it, { selected: !it.selected }) : it;
      });
      return Object.assign({}, p, { [section]: nextArr });
    });
  }

  async function handleAnalyze() {
    setError(null);
    setBusy(true);
    setPreview(null);
    setProgress("Reading your file…");
    try {
      let filePart = null;
      let pdfPages = null;
      if (file) {
        if (file.type === "application/pdf") {
          setProgress("Splitting PDF into pages…");
          pdfPages = await pdfToPageImages(file);
          if (pdfPages.length === 0) {
            throw new Error("Could not read any pages from that PDF.");
          }
        } else if (file.type.indexOf("image/") === 0) {
          const base64 = await readFileAsBase64(file);
          filePart = { type: "image", source: { type: "base64", media_type: file.type, data: base64 } };
        } else {
          throw new Error("That file type is not supported yet — try an image, a PDF, or paste text instead.");
        }
      }

      const existingJa = {};
      notes.vocab.forEach(function (v) { existingJa[normalize(v.japanese)] = true; });
      const existingGr = {};
      notes.grammar.forEach(function (g) { existingGr[normalize(g.point)] = true; });
      const existingEx = {};
      notes.examples.forEach(function (e) { existingEx[normalize(e.japanese)] = true; });

      let sessionVocab = [];
      let sessionGrammar = [];
      let sessionExamples = [];
      const MAX_PASSES = pdfPages ? pdfPages.length : 15;
      let pass = 0;
      let hasMore = true;
      let stoppedEarly = false;

      while (hasMore && pass < MAX_PASSES) {
        pass = pass + 1;
        const foundSoFar = sessionVocab.length + sessionGrammar.length + sessionExamples.length;
        setProgress(pdfPages
          ? "Reading page " + pass + " of " + pdfPages.length + "…"
          : (pass === 1 ? "Reading your notes…" : "Pass " + pass + " — " + foundSoFar + " new item" + (foundSoFar === 1 ? "" : "s") + " found so far…"));

        const knownVocab = notes.vocab.concat(sessionVocab).slice(-300).map(function (v) { return v.japanese + "|" + v.reading; }).join(", ") || "(none yet)";
        const knownGrammar = notes.grammar.concat(sessionGrammar).slice(-200).map(function (g) { return g.point; }).join(", ") || "(none yet)";
        const knownExamples = notes.examples.concat(sessionExamples).slice(-200).map(function (e) { return e.japanese; }).join(", ") || "(none yet)";
        const promptText =
          "Already-saved vocabulary (japanese|reading): " + knownVocab + "\n" +
          "Already-saved grammar points: " + knownGrammar + "\n" +
          "Already-saved example sentences: " + knownExamples + "\n\n" +
          (text.trim() ? "Typed notes:\n" + text.trim() + "\n\n" : "") +
          "Extract only new items not in the already-saved lists above, following the JSON format from your instructions.";

        const contentParts = [];
        if (pdfPages) {
          contentParts.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: pdfPages[pass - 1] } });
        } else if (filePart) {
          contentParts.push(filePart);
        }
        contentParts.push({ type: "text", text: promptText });

        const raw = await callClaude(SYSTEM_ORGANIZE, contentParts, 4096);
        const cleaned = stripFences(raw);
        let parsed;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e) {
          if (pass === 1) {
            throw new Error("The AI's answer got cut off before it could finish. Try again, or paste a smaller chunk of text.");
          }
          stoppedEarly = true;
          break;
        }

        const newVocab = (parsed.vocab || []).filter(function (v) { return v.japanese && !existingJa[normalize(v.japanese)]; }).map(function (v) { existingJa[normalize(v.japanese)] = true; return Object.assign({}, v, { selected: true }); });
        const newGrammar = (parsed.grammar || []).filter(function (g) { return g.point && !existingGr[normalize(g.point)]; }).map(function (g) { existingGr[normalize(g.point)] = true; return Object.assign({}, g, { selected: true }); });
        const newExamples = (parsed.examples || []).filter(function (e) { return e.japanese && !existingEx[normalize(e.japanese)]; }).map(function (e) { existingEx[normalize(e.japanese)] = true; return Object.assign({}, e, { selected: true }); });

        sessionVocab = sessionVocab.concat(newVocab);
        sessionGrammar = sessionGrammar.concat(newGrammar);
        sessionExamples = sessionExamples.concat(newExamples);

        if (pdfPages) {
          hasMore = pass < pdfPages.length;
        } else {
          hasMore = !!parsed.has_more;
          if (newVocab.length + newGrammar.length + newExamples.length === 0) {
            break;
          }
        }
      }

      if (sessionVocab.length + sessionGrammar.length + sessionExamples.length === 0) {
        setError("No new items found — everything here may already be saved, or the AI could not read the notes clearly.");
      } else if (stoppedEarly) {
        setError("Got through most of it, but one pass came back unreadable so it stopped early. Everything found up to that point is below — upload the same file again afterward to try for more.");
      } else if (hasMore) {
        setError("There's still more in this file after " + MAX_PASSES + " passes. Save what's below, then upload the same file again to keep going.");
      }
      setPreview({ vocab: sessionVocab, grammar: sessionGrammar, examples: sessionExamples });
    } catch (err) {
      setError(err.message || "Something went wrong analyzing your notes.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function handleSave() {
    const strip = function (arr) { return arr.filter(function (it) { return it.selected; }).map(function (it) { const copy = Object.assign({}, it); delete copy.selected; return copy; }); };
    const withIds = function (arr) { return arr.map(function (it) { return Object.assign({ id: crypto.randomUUID() }, it); }); };
    const next = Object.assign({}, notes, {
      vocab: notes.vocab.concat(withIds(strip(preview.vocab))),
      grammar: notes.grammar.concat(withIds(strip(preview.grammar))),
      examples: notes.examples.concat(withIds(strip(preview.examples)))
    });
    await onSaved(next);
    setPreview(null);
    setText("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <div className="kb-wordmark" style={{ fontSize: 26 }}>Add notes</div>
      <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
        Upload a photo or PDF of your lesson, or paste text below. New vocabulary, grammar, and example sentences get pulled out — anything already saved gets skipped automatically.
      </p>

      <div style={{ marginTop: 16 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={function (e) { setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); }}
        />
        {file && <p style={{ fontSize: 13, marginTop: 6 }}>{file.name}</p>}
      </div>

      <p style={{ margin: "14px 0 6px", fontSize: 13, color: "var(--ink-soft)" }}>Or paste text:</p>
      <textarea
        className="kb-textarea"
        rows={5}
        value={text}
        onChange={function (e) { setText(e.target.value); }}
        placeholder="Example: 食べる - to eat (Verb)"
      />

      <div style={{ marginTop: 14 }}>
        <button className="kb-btn" onClick={handleAnalyze} disabled={busy || (!file && !text.trim())}>
          {busy ? (progress || "Reading your notes…") : "Analyze notes"}
        </button>
        {busy && <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>Big files may take a little while — it works through them in batches automatically.</p>}
      </div>

      {error && <p style={{ color: "var(--shu)", marginTop: 14 }}>{error}</p>}

      {preview && (preview.vocab.length + preview.grammar.length + preview.examples.length > 0) && (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>Uncheck anything you do not want to save:</p>

          {preview.vocab.length > 0 && (
            <div>
              <div className="kb-topic-header">Vocabulary</div>
              {preview.vocab.map(function (v, i) {
                return (
                  <label key={i} className="kb-item-row" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={v.selected} onChange={function () { toggleSelect("vocab", i); }} />
                    <span style={{ flex: 1, marginLeft: 10 }}>
                      <strong>{v.japanese}</strong>{v.reading ? " (" + v.reading + ")" : ""} — {v.meaning}
                      <span style={{ color: "var(--ink-soft)", marginLeft: 6, fontSize: 12 }}>{v.topic}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {preview.grammar.length > 0 && (
            <div>
              <div className="kb-topic-header">Grammar</div>
              {preview.grammar.map(function (g, i) {
                return (
                  <label key={i} className="kb-item-row" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={g.selected} onChange={function () { toggleSelect("grammar", i); }} />
                    <span style={{ flex: 1, marginLeft: 10 }}>
                      <strong>{g.point}</strong> — {g.explanation}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {preview.examples.length > 0 && (
            <div>
              <div className="kb-topic-header">Example sentences</div>
              {preview.examples.map(function (e, i) {
                return (
                  <label key={i} className="kb-item-row" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={e.selected} onChange={function () { toggleSelect("examples", i); }} />
                    <span style={{ flex: 1, marginLeft: 10 }}>{e.japanese} — {e.translation}</span>
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="kb-btn" onClick={handleSave}>Save selected</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BrowseView({ notes, onChange }) {
  const [explainState, setExplainState] = useState({});
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  function matches() {
    const fields = Array.prototype.slice.call(arguments);
    return fields.some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; });
  }

  const filteredVocab = q ? notes.vocab.filter(function (v) { return matches(v.japanese, v.reading, v.meaning, v.topic); }) : notes.vocab;
  const filteredGrammar = q ? notes.grammar.filter(function (g) { return matches(g.point, g.explanation, g.example_ja, g.example_en); }) : notes.grammar;
  const filteredExamples = q ? notes.examples.filter(function (e) { return matches(e.japanese, e.translation); }) : notes.examples;

  const byTopic = {};
  filteredVocab.forEach(function (v) {
    const t = v.topic || "Uncategorized";
    if (!byTopic[t]) byTopic[t] = [];
    byTopic[t].push(v);
  });

  async function explainMore(item, section) {
    setExplainState(function (s) {
      const existing = s[item.id];
      return Object.assign({}, s, { [item.id]: { loading: true, text: existing ? existing.text : undefined } });
    });
    try {
      const desc =
        section === "vocab"
          ? "Vocabulary word: " + item.japanese + " (" + item.reading + ") meaning \"" + item.meaning + "\", topic " + item.topic + "."
          : section === "grammar"
          ? "Grammar point: " + item.point + ". Short explanation already saved: " + item.explanation + "."
          : "Example sentence: " + item.japanese + " — " + item.translation + ".";
      const raw = await callClaude(SYSTEM_EXPLAIN, [{ type: "text", text: desc }], 700);
      setExplainState(function (s) { return Object.assign({}, s, { [item.id]: { loading: false, text: raw.trim() } }); });
    } catch (err) {
      setExplainState(function (s) { return Object.assign({}, s, { [item.id]: { loading: false, text: "Could not get an explanation just now. Try again." } }); });
    }
  }

  function removeItem(section, id) {
    const next = Object.assign({}, notes, { [section]: notes[section].filter(function (it) { return it.id !== id; }) });
    onChange(next);
  }

  function renderExplain(item) {
    const st = explainState[item.id];
    return (
      <div style={{ marginTop: 6 }}>
        {!st && (
          <button className="kb-btn secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={function () { explainMore(item, item._section); }}>
            Explain more
          </button>
        )}
        {st && st.loading && <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>Thinking…</p>}
        {st && !st.loading && (
          <div className="kb-card" style={{ marginTop: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
            {st.text}
            <div style={{ marginTop: 8 }}>
              <button className="kb-btn secondary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={function () { explainMore(item, item._section); }}>
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="kb-wordmark" style={{ fontSize: 26 }}>Browse</div>

      {notes.vocab.length === 0 && notes.grammar.length === 0 && notes.examples.length === 0 && (
        <p style={{ marginTop: 16, color: "var(--ink-soft)" }}>Nothing saved yet. Add some notes first.</p>
      )}

      {(notes.vocab.length > 0 || notes.grammar.length > 0 || notes.examples.length > 0) && (
        <input
          className="kb-input"
          type="text"
          placeholder="Search your notes…"
          value={query}
          onChange={function (e) { setQuery(e.target.value); }}
          style={{ marginTop: 16, marginBottom: 8 }}
        />
      )}

      {q && filteredVocab.length === 0 && filteredGrammar.length === 0 && filteredExamples.length === 0 && (
        <p style={{ marginTop: 16, color: "var(--ink-soft)" }}>No matches for "{query}".</p>
      )}

      {Object.keys(byTopic).sort().map(function (topic) {
        return (
          <div key={topic}>
            <div className="kb-topic-header">{topic}</div>
            {byTopic[topic].map(function (v) {
              return (
                <div key={v.id} className="kb-item-row" style={{ flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <span>
                      <strong>{v.japanese}</strong>{v.reading ? " (" + v.reading + ")" : ""} — {v.meaning}
                    </span>
                    <button className="kb-btn danger" style={{ fontSize: 11, padding: "3px 8px" }} onClick={function () { removeItem("vocab", v.id); }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {renderExplain(Object.assign({}, v, { _section: "vocab" }))}
                </div>
              );
            })}
          </div>
        );
      })}

      {filteredGrammar.length > 0 && (
        <div>
          <div className="kb-topic-header">Grammar</div>
          {filteredGrammar.map(function (g) {
            return (
              <div key={g.id} className="kb-item-row" style={{ flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <span>
                    <strong>{g.point}</strong> — {g.explanation}
                    {g.example_ja && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{g.example_ja} — {g.example_en}</div>}
                  </span>
                  <button className="kb-btn danger" style={{ fontSize: 11, padding: "3px 8px" }} onClick={function () { removeItem("grammar", g.id); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                {renderExplain(Object.assign({}, g, { _section: "grammar" }))}
              </div>
            );
          })}
        </div>
      )}

      {filteredExamples.length > 0 && (
        <div>
          <div className="kb-topic-header">Example sentences</div>
          {filteredExamples.map(function (e) {
            return (
              <div key={e.id} className="kb-item-row" style={{ flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <span>{e.japanese} — {e.translation}</span>
                  <button className="kb-btn danger" style={{ fontSize: 11, padding: "3px 8px" }} onClick={function () { removeItem("examples", e.id); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                {renderExplain(Object.assign({}, e, { _section: "examples" }))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExportView({ notes, onClear }) {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    setClearing(true);
    try {
      await onClear();
      setConfirming(false);
    } finally {
      setClearing(false);
    }
  }

  function handleExport() {
    const payload = {
      exportedAt: new Date().toISOString(),
      vocab: notes.vocab,
      grammar: notes.grammar,
      examples: notes.examples,
      progress: notes.progress
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kotobachou-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const total = notes.vocab.length + notes.grammar.length + notes.examples.length;

  return (
    <div>
      <div className="kb-wordmark" style={{ fontSize: 26 }}>Back up</div>
      <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
        Download everything saved as a file you can keep. {total} item{total === 1 ? "" : "s"} saved right now.
      </p>
      <button className="kb-btn" style={{ marginTop: 16 }} onClick={handleExport} disabled={total === 0}>
        Download backup
      </button>

      <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--paper-line)" }}>
        <div className="kb-topic-header" style={{ color: "var(--shu)" }}>Danger zone</div>
        <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
          Permanently erase everything saved to your account so you can start over with a fresh set of notes. Download a backup first if you might want this data later.
        </p>
        {!confirming ? (
          <button className="kb-btn danger" style={{ marginTop: 12 }} onClick={function () { setConfirming(true); }} disabled={total === 0}>
            Clear all data
          </button>
        ) : (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: "bold" }}>
              Delete all {total} item{total === 1 ? "" : "s"}? This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="kb-btn danger" onClick={handleClear} disabled={clearing}>
                {clearing ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button className="kb-btn secondary" onClick={function () { setConfirming(false); }} disabled={clearing}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const HIRAGANA = [
  ["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"],
  ["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"],
  ["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"],
  ["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"],
  ["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"],
  ["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"],
  ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
  ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
  ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
  ["わ", "wa"], ["を", "wo"], ["ん", "n"],
  ["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"],
  ["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"],
  ["だ", "da"], ["ぢ", "ji"], ["づ", "zu"], ["で", "de"], ["ど", "do"],
  ["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"],
  ["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"]
];

const KATAKANA = [
  ["ア", "a"], ["イ", "i"], ["ウ", "u"], ["エ", "e"], ["オ", "o"],
  ["カ", "ka"], ["キ", "ki"], ["ク", "ku"], ["ケ", "ke"], ["コ", "ko"],
  ["サ", "sa"], ["シ", "shi"], ["ス", "su"], ["セ", "se"], ["ソ", "so"],
  ["タ", "ta"], ["チ", "chi"], ["ツ", "tsu"], ["テ", "te"], ["ト", "to"],
  ["ナ", "na"], ["ニ", "ni"], ["ヌ", "nu"], ["ネ", "ne"], ["ノ", "no"],
  ["ハ", "ha"], ["ヒ", "hi"], ["フ", "fu"], ["ヘ", "he"], ["ホ", "ho"],
  ["マ", "ma"], ["ミ", "mi"], ["ム", "mu"], ["メ", "me"], ["モ", "mo"],
  ["ヤ", "ya"], ["ユ", "yu"], ["ヨ", "yo"],
  ["ラ", "ra"], ["リ", "ri"], ["ル", "ru"], ["レ", "re"], ["ロ", "ro"],
  ["ワ", "wa"], ["ヲ", "wo"], ["ン", "n"],
  ["ガ", "ga"], ["ギ", "gi"], ["グ", "gu"], ["ゲ", "ge"], ["ゴ", "go"],
  ["ザ", "za"], ["ジ", "ji"], ["ズ", "zu"], ["ゼ", "ze"], ["ゾ", "zo"],
  ["ダ", "da"], ["ヂ", "ji"], ["ヅ", "zu"], ["デ", "de"], ["ド", "do"],
  ["バ", "ba"], ["ビ", "bi"], ["ブ", "bu"], ["ベ", "be"], ["ボ", "bo"],
  ["パ", "pa"], ["ピ", "pi"], ["プ", "pu"], ["ペ", "pe"], ["ポ", "po"]
];

const KANJI = [
  ["一", "ichi", "one"], ["二", "ni", "two"], ["三", "san", "three"], ["四", "yon", "four"], ["五", "go", "five"],
  ["六", "roku", "six"], ["七", "nana", "seven"], ["八", "hachi", "eight"], ["九", "kyuu", "nine"], ["十", "juu", "ten"],
  ["百", "hyaku", "hundred"], ["千", "sen", "thousand"], ["万", "man", "ten thousand"], ["円", "en", "yen"], ["時", "ji", "hour / time"],
  ["半", "han", "half"], ["分", "fun", "minute"], ["日", "hi", "day / sun"], ["月", "tsuki", "month / moon"], ["火", "hi", "fire"],
  ["水", "mizu", "water"], ["木", "ki", "tree / wood"], ["金", "kin", "gold / money"], ["土", "tsuchi", "earth / soil"], ["年", "toshi", "year"],
  ["上", "ue", "up / above"], ["下", "shita", "down / below"], ["中", "naka", "middle / inside"], ["外", "soto", "outside"], ["右", "migi", "right"],
  ["左", "hidari", "left"], ["前", "mae", "front / before"], ["後", "ushiro", "behind / after"], ["北", "kita", "north"], ["南", "minami", "south"],
  ["東", "higashi", "east"], ["西", "nishi", "west"], ["人", "hito", "person"], ["子", "ko", "child"], ["女", "onna", "woman"],
  ["男", "otoko", "man"], ["父", "chichi", "father"], ["母", "haha", "mother"], ["友", "tomo", "friend"], ["私", "watashi", "I / me"],
  ["今", "ima", "now"], ["毎", "mai", "every"], ["何", "nani", "what"], ["学", "gaku", "study"], ["校", "kou", "school"],
  ["生", "sei", "life / student"], ["先", "sen", "previous / ahead"], ["社", "sha", "company"], ["会", "kai", "meeting"], ["食", "taberu", "eat"],
  ["飲", "nomu", "drink"], ["見", "miru", "see"], ["聞", "kiku", "hear / ask"], ["読", "yomu", "read"], ["書", "kaku", "write"],
  ["話", "hanasu", "speak"], ["言", "iu", "say"], ["語", "go", "language"], ["入", "hairu", "enter"], ["出", "deru", "exit"],
  ["行", "iku", "go"], ["来", "kuru", "come"], ["帰", "kaeru", "return"], ["買", "kau", "buy"], ["売", "uru", "sell"],
  ["持", "motsu", "hold"], ["待", "matsu", "wait"], ["立", "tatsu", "stand"], ["休", "yasumu", "rest"], ["働", "hataraku", "work"],
  ["使", "tsukau", "use"], ["作", "tsukuru", "make"], ["思", "omou", "think"], ["知", "shiru", "know"], ["歩", "aruku", "walk"],
  ["走", "hashiru", "run"], ["好", "suki", "like"], ["悪", "warui", "bad"], ["高", "takai", "high / expensive"], ["安", "yasui", "cheap / safe"],
  ["大", "ookii", "big"], ["小", "chiisai", "small"], ["新", "atarashii", "new"], ["古", "furui", "old"], ["長", "nagai", "long"],
  ["多", "ooi", "many"], ["少", "sukunai", "few"], ["早", "hayai", "early"], ["白", "shiroi", "white"], ["黒", "kuroi", "black"],
  ["赤", "akai", "red"], ["青", "aoi", "blue"], ["天", "ten", "sky / heaven"], ["気", "ki", "spirit / feeling"], ["雨", "ame", "rain"],
  ["電", "den", "electricity"], ["車", "kuruma", "car"], ["駅", "eki", "station"], ["道", "michi", "road / way"], ["店", "mise", "shop"],
  ["家", "ie", "house / home"], ["国", "kuni", "country"], ["本", "hon", "book / origin"], ["名", "na", "name"], ["物", "mono", "thing"],
  ["週", "shuu", "week"], ["朝", "asa", "morning"], ["昼", "hiru", "daytime"], ["夜", "yoru", "night"], ["体", "karada", "body"],
  ["手", "te", "hand"], ["足", "ashi", "foot / leg"], ["目", "me", "eye"], ["耳", "mimi", "ear"], ["口", "kuchi", "mouth"],
  ["心", "kokoro", "heart / mind"], ["間", "aida", "between"]
];

function PracticeView({ progress, onAnswer }) {
  const [kanaSet, setKanaSet] = useState("hiragana");
  const [smart, setSmart] = useState(true);
  const [mode, setMode] = useState("mc");
  const [question, setQuestion] = useState(null);
  const [options, setOptions] = useState([]);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  function pool() {
    if (kanaSet === "hiragana") return HIRAGANA;
    if (kanaSet === "katakana") return KATAKANA;
    if (kanaSet === "kanji") return KANJI;
    return HIRAGANA.concat(KATAKANA);
  }

  function nextQuestion() {
    const p = pool();
    let pick;
    if (smart) {
      const items = p.map(function (t) { return { key: "p:" + t[0], tuple: t }; });
      pick = pickNext(items, progress, question && "p:" + question.kana).tuple;
    } else {
      pick = p[Math.floor(Math.random() * p.length)];
    }
    const q = { kana: pick[0], romaji: pick[1], meaning: pick[2] };
    setQuestion(q);
    setFeedback(null);
    setTypedAnswer("");
    if (mode === "mc") {
      const distractors = pickN(p, 3, pick).map(function (d) { return d[1]; });
      setOptions(shuffle(distractors.concat([q.romaji])));
    }
  }

  useEffect(function () {
    nextQuestion();
    // eslint-disable-next-line
  }, [kanaSet, mode, smart]);

  function answerMc(choice) {
    if (feedback) return;
    const correct = choice === question.romaji;
    setFeedback(correct ? "correct" : "incorrect");
    setScore(function (s) { return { correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }; });
    onAnswer("p:" + question.kana, correct);
  }

  function answerTyped() {
    if (feedback) return;
    const correct = normalize(typedAnswer) === normalize(question.romaji);
    setFeedback(correct ? "correct" : "incorrect");
    setScore(function (s) { return { correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }; });
    onAnswer("p:" + question.kana, correct);
  }

  if (!question) return null;

  return (
    <div>
      <div className="kb-wordmark" style={{ fontSize: 26 }}>Practice</div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className={"kb-btn" + (kanaSet === "hiragana" ? "" : " secondary")} onClick={function () { setKanaSet("hiragana"); }}>Hiragana</button>
        <button className={"kb-btn" + (kanaSet === "katakana" ? "" : " secondary")} onClick={function () { setKanaSet("katakana"); }}>Katakana</button>
        <button className={"kb-btn" + (kanaSet === "both" ? "" : " secondary")} onClick={function () { setKanaSet("both"); }}>Both</button>
        <button className={"kb-btn" + (kanaSet === "kanji" ? "" : " secondary")} onClick={function () { setKanaSet("kanji"); }}>Kanji</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className={"kb-btn" + (mode === "mc" ? "" : " secondary")} onClick={function () { setMode("mc"); }}>Multiple choice</button>
        <button className={"kb-btn" + (mode === "typed" ? "" : " secondary")} onClick={function () { setMode("typed"); }}>Type the answer</button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={smart} onChange={function () { setSmart(!smart); }} />
        Smart review (brings back what you missed, checks old ones now and then)
      </label>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-soft)" }}>Score: {score.correct} / {score.total}</p>

      <div className="kb-card" style={{ marginTop: 12, textAlign: "center", padding: 32 }}>
        <div style={{ fontFamily: "'Zen Maru Gothic', sans-serif", fontSize: 64 }}>{question.kana}</div>
      </div>

      {mode === "mc" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          {options.map(function (opt, i) {
            let bg = "transparent";
            if (feedback && opt === question.romaji) bg = "rgba(42,63,92,0.15)";
            return (
              <button key={i} className="kb-btn secondary" style={{ background: bg }} onClick={function () { answerMc(opt); }}>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {mode === "typed" && (
        <div style={{ marginTop: 16 }}>
          <input
            className="kb-input"
            value={typedAnswer}
            onChange={function (e) { setTypedAnswer(e.target.value); }}
            onKeyDown={function (e) { if (e.key === "Enter") answerTyped(); }}
            placeholder="romaji, e.g. ka"
            disabled={!!feedback}
          />
          {!feedback && <button className="kb-btn" style={{ marginTop: 10 }} onClick={answerTyped}>Check</button>}
        </div>
      )}

      {feedback && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: feedback === "correct" ? "var(--indigo)" : "var(--shu)", fontWeight: "bold" }}>
            {feedback === "correct" ? "Correct!" : "Not quite — it's \"" + question.romaji + "\"."}
            {question.meaning ? " (" + question.meaning + ")" : ""}
          </p>
          <button className="kb-btn" onClick={nextQuestion}>Next</button>
        </div>
      )}
    </div>
  );
}

function QuizView({ notes, onAnswer }) {
  const [mode, setMode] = useState("mc");
  const [includeKanji, setIncludeKanji] = useState(true);
  const [smart, setSmart] = useState(true);
  const [question, setQuestion] = useState(null);
  const [options, setOptions] = useState([]);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  function pool() {
    const fromVocab = notes.vocab.map(function (v) { return { key: v.id || "v:" + v.japanese, prompt: v.japanese, sub: v.reading, answer: v.meaning }; });
    const fromGrammar = notes.grammar.map(function (g) { return { key: g.id || "g:" + g.point, prompt: g.point, sub: "", answer: g.explanation }; });
    const fromKanji = includeKanji ? KANJI.map(function (k) { return { key: "kanji:" + k[0], prompt: k[0], sub: k[1], answer: k[2] }; }) : [];
    return fromVocab.concat(fromGrammar).concat(fromKanji);
  }

  function nextQuestion() {
    const p = pool();
    if (p.length === 0) {
      setQuestion(null);
      return;
    }
    const pick = smart ? pickNext(p, notes.progress, question && question.key) : p[Math.floor(Math.random() * p.length)];
    setQuestion(pick);
    setFeedback(null);
    setTypedAnswer("");
    if (mode === "mc") {
      const distractors = pickN(p, 3, pick).map(function (d) { return d.answer; });
      setOptions(shuffle(distractors.concat([pick.answer])));
    }
  }

  useEffect(function () {
    nextQuestion();
    // eslint-disable-next-line
  }, [mode, includeKanji, smart, notes.vocab.length, notes.grammar.length]);

  function answerMc(choice) {
    if (feedback) return;
    const correct = choice === question.answer;
    setFeedback(correct ? "correct" : "incorrect");
    setScore(function (s) { return { correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }; });
    onAnswer(question.key, correct);
  }

  function answerTyped() {
    if (feedback) return;
    const correct = normalize(typedAnswer) === normalize(question.answer);
    setFeedback(correct ? "correct" : "unsure");
    if (correct) {
      setScore(function (s) { return { correct: s.correct + 1, total: s.total + 1 }; });
      onAnswer(question.key, true);
    }
  }

  function selfGrade(wasRight) {
    setScore(function (s) { return { correct: s.correct + (wasRight ? 1 : 0), total: s.total + 1 }; });
    onAnswer(question.key, wasRight);
    nextQuestion();
  }

  const poolSize = pool().length;
  const stats = progressStats(pool(), notes.progress);
  const weak = pool()
    .filter(function (item) { return notes.progress[item.key] && notes.progress[item.key].wrong > 0; })
    .sort(function (a, b) {
      const ra = notes.progress[a.key];
      const rb = notes.progress[b.key];
      return (rb.wrong - rb.right) - (ra.wrong - ra.right) || rb.wrong - ra.wrong;
    })
    .slice(0, 10);

  if (poolSize < 4) {
    return (
      <div>
        <div className="kb-wordmark" style={{ fontSize: 26 }}>Quiz</div>
        <p style={{ marginTop: 16, color: "var(--ink-soft)" }}>
          You need at least a few saved words, grammar points, or kanji questions before there's enough to quiz you on.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={includeKanji} onChange={function () { setIncludeKanji(!includeKanji); }} />
          Include kanji questions
        </label>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div>
      <div className="kb-wordmark" style={{ fontSize: 26 }}>Quiz</div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className={"kb-btn" + (mode === "mc" ? "" : " secondary")} onClick={function () { setMode("mc"); }}>Multiple choice</button>
        <button className={"kb-btn" + (mode === "typed" ? "" : " secondary")} onClick={function () { setMode("typed"); }}>Type the answer</button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={includeKanji} onChange={function () { setIncludeKanji(!includeKanji); }} />
        Include kanji questions
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={smart} onChange={function () { setSmart(!smart); }} />
        Smart review (brings back what you missed, checks old ones now and then)
      </label>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-soft)" }}>
        Score: {score.correct} / {score.total} · Due {stats.due} · New {stats.fresh} · Learning {stats.learning} · Known {stats.known}
      </p>

      <div className="kb-card" style={{ marginTop: 12, textAlign: "center", padding: 32 }}>
        <div style={{ fontFamily: "'Zen Maru Gothic', sans-serif", fontSize: 34 }}>{question.prompt}</div>
        {question.sub && <div style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 6 }}>{question.sub}</div>}
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>What does this mean?</div>
      </div>

      {mode === "mc" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          {options.map(function (opt, i) {
            let bg = "transparent";
            if (feedback && opt === question.answer) bg = "rgba(42,63,92,0.15)";
            return (
              <button key={i} className="kb-btn secondary" style={{ background: bg }} onClick={function () { answerMc(opt); }}>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {mode === "typed" && (
        <div style={{ marginTop: 16 }}>
          <input
            className="kb-input"
            value={typedAnswer}
            onChange={function (e) { setTypedAnswer(e.target.value); }}
            onKeyDown={function (e) { if (e.key === "Enter") answerTyped(); }}
            placeholder="type the meaning"
            disabled={!!feedback}
          />
          {!feedback && <button className="kb-btn" style={{ marginTop: 10 }} onClick={answerTyped}>Check</button>}
        </div>
      )}

      {feedback === "correct" && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "var(--indigo)", fontWeight: "bold" }}>Correct!</p>
          <button className="kb-btn" onClick={nextQuestion}>Next</button>
        </div>
      )}

      {feedback === "incorrect" && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "var(--shu)", fontWeight: "bold" }}>Not quite — it's "{question.answer}".</p>
          <button className="kb-btn" onClick={nextQuestion}>Next</button>
        </div>
      )}

      {feedback === "unsure" && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "var(--ink-soft)" }}>You said "{typedAnswer}". The saved answer is "{question.answer}".</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="kb-btn" onClick={function () { selfGrade(true); }}>Close enough, count it right</button>
            <button className="kb-btn danger" onClick={function () { selfGrade(false); }}>No, count it wrong</button>
          </div>
        </div>
      )}

      {weak.length > 0 && (
        <details style={{ marginTop: 28 }}>
          <summary style={{ cursor: "pointer", fontSize: 14 }}>What I keep getting wrong ({weak.length})</summary>
          {weak.map(function (item) {
            const rec = notes.progress[item.key];
            return (
              <div key={item.key} className="kb-item-row">
                <span style={{ flex: 1 }}>
                  <strong>{item.prompt}</strong>{item.sub ? " (" + item.sub + ")" : ""} — {item.answer}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{rec.right} right · {rec.wrong} wrong</span>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
