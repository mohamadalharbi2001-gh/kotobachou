// Helpers for the English -> Japanese and fill-in-the-blank quiz types.

const ROMAJI = {
  a: "あ", i: "い", u: "う", e: "え", o: "お",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  sa: "さ", si: "し", shi: "し", su: "す", se: "せ", so: "そ",
  ta: "た", ti: "ち", chi: "ち", tu: "つ", tsu: "つ", te: "て", to: "と",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  wa: "わ", wo: "を", n: "ん",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  kya: "きゃ", kyu: "きゅ", kyo: "きょ",
  sha: "しゃ", shu: "しゅ", sho: "しょ", sya: "しゃ", syu: "しゅ", syo: "しょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ",
  nya: "にゃ", nyu: "にゅ", nyo: "にょ",
  hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
  mya: "みゃ", myu: "みゅ", myo: "みょ",
  rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", jya: "じゃ", jyu: "じゅ", jyo: "じょ", zya: "じゃ", zyu: "じゅ", zyo: "じょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ",
  pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
  la: "ぁ", li: "ぃ", lu: "ぅ", le: "ぇ", lo: "ぉ"
};

const VOWELS = "aiueo";

// "gakkou" -> "がっこう". Anything that isn't romaji (kana, kanji) is passed through.
export function romajiToKana(input) {
  const s = (input || "").toLowerCase().replace(/\s+/g, "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // doubled consonant -> small tsu (but not "nn"); "tch" counts too (matcha)
    if (
      i + 1 < s.length &&
      ((c === s[i + 1] && /[bcdfghjklmpqrstvwxyz]/.test(c)) || (c === "t" && s.substr(i + 1, 2) === "ch"))
    ) {
      out += "っ";
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = 3; len >= 1; len--) {
      const chunk = s.substr(i, len);
      if (ROMAJI[chunk]) {
        // "n" only counts as ん when it is not the start of na/ni/nu/ne/no/nya...
        if (chunk === "n") {
          const next = s[i + 1];
          if (next && (VOWELS.indexOf(next) !== -1 || next === "y")) continue;
          out += "ん";
          // "nn" is ん, but in "konnichiwa" the second n starts "ni"
          const afterNext = s[i + 2];
          const secondNStartsSyllable = next === "n" && afterNext && (VOWELS.indexOf(afterNext) !== -1 || afterNext === "y");
          i += next === "'" || (next === "n" && !secondNStartsSyllable) ? 2 : 1;
          matched = true;
          break;
        }
        out += ROMAJI[chunk];
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += c === "-" ? "ー" : c;
      i += 1;
    }
  }
  return out;
}

// Katakana -> hiragana, drop spaces and punctuation, so answers compare fairly.
export function toHiragana(s) {
  return (s || "")
    .replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); })
    .replace(/[\s、。，．・「」『』（）()!?！？~〜]/g, "")
    .trim();
}

// Does a typed answer match any accepted form (kanji, kana reading, or romaji)?
export function matchesJapanese(typed, accepted) {
  const t = (typed || "").trim();
  if (!t) return false;
  const candidates = [t, toHiragana(t), toHiragana(romajiToKana(t))];
  return accepted.some(function (a) {
    if (!a) return false;
    const forms = [a, toHiragana(a)];
    return candidates.some(function (c) { return forms.indexOf(c) !== -1; });
  });
}

const HIRAGANA_CHAR = /[぀-ゟ]/;
const PARTICLES = ["を", "に", "の", "と", "へ"];

// Is this vocab entry safe to blank out of a sentence?
function usableWord(form) {
  if (!form) return false;
  if (form.length === 1 && HIRAGANA_CHAR.test(form)) return false;
  return true;
}

// Build fill-in-the-blank questions from saved example sentences (and grammar examples).
export function buildCloze(notes) {
  const sentences = [];
  (notes.examples || []).forEach(function (e) {
    if (e.japanese) sentences.push({ ja: e.japanese, en: e.translation || "" });
  });
  (notes.grammar || []).forEach(function (g) {
    if (g.example_ja) sentences.push({ ja: g.example_ja, en: g.example_en || "" });
  });

  const words = (notes.vocab || [])
    .map(function (v) { return { japanese: v.japanese, reading: v.reading }; })
    .filter(function (v) { return usableWord(v.japanese); })
    .sort(function (a, b) { return b.japanese.length - a.japanese.length; });

  const items = [];
  const seen = {};
  sentences.forEach(function (s) {
    if (seen[s.ja]) return;
    seen[s.ja] = true;

    // 1) a saved vocabulary word inside the sentence
    let used = 0;
    let working = s.ja;
    for (let k = 0; k < words.length && used < 2; k++) {
      const w = words[k];
      const idx = working.indexOf(w.japanese);
      if (idx === -1) continue;
      // skip a shorter word that sits inside a longer one we already blanked
      const prompt = s.ja.replace(w.japanese, "＿＿＿");
      items.push({
        key: "c:" + s.ja + ":" + w.japanese,
        kind: "word",
        prompt: prompt,
        sub: s.en,
        answer: w.japanese,
        accept: [w.japanese, w.reading],
        say: s.ja
      });
      working = working.replace(w.japanese, "＊");
      used++;
    }

    // 2) a clear-cut particle that follows a noun (kanji/katakana)
    for (let p = 1; p < s.ja.length - 1; p++) {
      const ch = s.ja[p];
      if (PARTICLES.indexOf(ch) === -1) continue;
      const before = s.ja[p - 1];
      if (HIRAGANA_CHAR.test(before) || /[、。\s＿]/.test(before)) continue;
      items.push({
        key: "c:" + s.ja + ":p" + p,
        kind: "particle",
        prompt: s.ja.slice(0, p) + "＿" + s.ja.slice(p + 1),
        sub: s.en,
        answer: ch,
        accept: [ch],
        say: s.ja
      });
      break;
    }
  });
  return items;
}

export const CLOZE_PARTICLES = PARTICLES;
