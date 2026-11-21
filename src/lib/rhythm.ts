// Daily rhythm generation.

/** Daily tempo range (picked in steps of 5). */
export const BPM_MIN = 80;
export const BPM_MAX = 120;
export const N_BARS = 4;
export const NB_ATTEMPTS = 3;
export const BEATS_PER_BAR = 4;
export const SUBDIV = 4; // grid resolution: 16th notes
export const SLOTS_PER_BAR = BEATS_PER_BAR * SUBDIV;

export interface Note {
	bar: number;
	/** position within the bar, in 16ths */
	start: number;
	/** duration in 16ths */
	dur: number;
	rest: boolean;
	/** index among played (non-rest) notes, -1 for rests */
	index: number;
}

export interface Rhythm {
	bpm: number;
	beatSec: number;
	/** duration of one 16th */
	slotSec: number;
	/** duration of the whole rhythm */
	totalSec: number;
	bars: Note[][];
	/** non-rest notes in order */
	hits: Note[];
	/** onset time in seconds (from the first downbeat) of each hit */
	onsets: number[];
}

/** One-beat patterns, durations in 16ths; negative = rest. */
const PATTERNS: { w: number; d: number[] }[] = [
	{ w: 3, d: [4] },
	{ w: 1, d: [-4] },
	{ w: 3, d: [2, 2] },
	{ w: 1.5, d: [-2, 2] },
	{ w: 2, d: [2, 1, 1] },
	{ w: 2, d: [1, 1, 2] },
	{ w: 1.5, d: [1, 1, 1, 1] },
	{ w: 1.5, d: [3, 1] },
	{ w: 1, d: [1, 2, 1] }
];

function hashString(s: string): number {
	let h = 1779033703 ^ s.length;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T extends { w: number }>(items: T[], rand: () => number): T {
	const total = items.reduce((s, i) => s + i.w, 0);
	let r = rand() * total;
	for (const it of items) {
		r -= it.w;
		if (r <= 0) return it;
	}
	return items[items.length - 1];
}

export function generateRhythm(seed: string): Rhythm {
	const rand = mulberry32(hashString(seed));
	const bars: Note[][] = [];
	const hits: Note[] = [];

	for (let bar = 0; bar < N_BARS; bar++) {
		const notes: Note[] = [];
		for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
			// The very first beat always starts with a note, as an anchor.
			const pool = bar === 0 && beat === 0 ? PATTERNS.filter((p) => p.d[0] > 0) : PATTERNS;
			let pos = beat * SUBDIV;
			for (const d of pick(pool, rand).d) {
				const note: Note = { bar, start: pos, dur: Math.abs(d), rest: d < 0, index: -1 };
				if (!note.rest) {
					note.index = hits.length;
					hits.push(note);
				}
				notes.push(note);
				pos += Math.abs(d);
			}
		}
		bars.push(notes);
	}

	// Tempo uses its own random stream so it doesn't change the notes for a given seed.
	const bpmRand = mulberry32(hashString(`${seed}-bpm`));
	const bpm = BPM_MIN + 5 * Math.floor(bpmRand() * ((BPM_MAX - BPM_MIN) / 5 + 1));
	const beatSec = 60 / bpm;
	const slotSec = beatSec / SUBDIV;
	const totalSec = N_BARS * BEATS_PER_BAR * beatSec;

	const onsets = hits.map((n) => (n.bar * SLOTS_PER_BAR + n.start) * slotSec);
	return { bpm, beatSec, slotSec, totalSec, bars, hits, onsets };
}

export function todayKey(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function puzzleNumber(key: string): number {
	const [y, m, d] = key.split('-').map(Number);
	return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
}
