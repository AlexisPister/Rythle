import type { Rhythm } from './rhythm';

export type Status = 'perfect' | 'good' | 'miss';

export const PERFECT_SEC = 0.045;
export const GOOD_SEC = 0.1;
/** points for a "close" note (a perfect note is worth 1) */
export const GOOD_WEIGHT = 0.6;
/** percentage points removed per extra tap */
export const EXTRA_PENALTY = 5;

export interface TapMark {
	/** position in 16ths from the first downbeat */
	pos: number;
	kind: 'perfect' | 'good' | 'extra' | 'live';
}

export interface Attempt {
	statuses: Status[];
	/** signed timing error in ms per note (negative = early), null if missed */
	errorsMs: (number | null)[];
	extras: number;
	taps: TapMark[];
	score: number;
	solved: boolean;
}

/**
 * Match taps (seconds relative to the first downbeat) to expected onsets.
 * Pairs are assigned greedily by smallest timing error.
 */
export function scoreAttempt(rhythm: Rhythm, tapTimes: number[]): Attempt {
	const { onsets, slotSec, totalSec } = rhythm;
	const taps = tapTimes.filter((t) => t >= -GOOD_SEC && t <= totalSec + GOOD_SEC);

	const pairs: { n: number; t: number; err: number }[] = [];
	onsets.forEach((o, n) =>
		taps.forEach((tap, t) => {
			const err = tap - o;
			if (Math.abs(err) <= GOOD_SEC) pairs.push({ n, t, err });
		})
	);
	pairs.sort((a, b) => Math.abs(a.err) - Math.abs(b.err));

	const noteErr: (number | null)[] = onsets.map(() => null);
	const tapUsed: (Status | null)[] = taps.map(() => null);
	for (const p of pairs) {
		if (noteErr[p.n] !== null || tapUsed[p.t] !== null) continue;
		noteErr[p.n] = p.err;
		tapUsed[p.t] = Math.abs(p.err) <= PERFECT_SEC ? 'perfect' : 'good';
	}

	const statuses: Status[] = noteErr.map((e) =>
		e === null ? 'miss' : Math.abs(e) <= PERFECT_SEC ? 'perfect' : 'good'
	);
	const extras = tapUsed.filter((u) => u === null).length;
	const perfect = statuses.filter((s) => s === 'perfect').length;
	const good = statuses.filter((s) => s === 'good').length;
	const raw =
		(100 * (perfect + GOOD_WEIGHT * good)) / Math.max(1, onsets.length) - EXTRA_PENALTY * extras;

	return {
		statuses,
		errorsMs: noteErr.map((e) => (e === null ? null : Math.round(e * 1000))),
		extras,
		taps: taps.map((t, i) => ({
			pos: t / slotSec,
			kind: (tapUsed[i] ?? 'extra') as TapMark['kind']
		})),
		score: Math.max(0, Math.round(raw)),
		solved: statuses.every((s) => s !== 'miss') && extras === 0
	};
}

const EMOJI: Record<Status, string> = { perfect: '🟩', good: '🟨', miss: '⬛' };

export function emojiRow(attempt: Attempt, rhythm: Rhythm): string {
	return rhythm.bars
		.map((bar) =>
			bar
				.filter((n) => !n.rest)
				.map((n) => EMOJI[attempt.statuses[n.index]])
				.join('')
		)
		.join(' ');
}
