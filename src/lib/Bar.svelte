<script lang="ts">
	// One bar of single-line percussion notation, rendered as SVG.
	// Horizontal spacing is proportional to time so taps and the playhead line up with notes.
	import { BEATS_PER_BAR, SLOTS_PER_BAR, SUBDIV, type Note } from './rhythm';
	import type { Status, TapMark } from './scoring';

	interface Props {
		notes: Note[];
		first?: boolean;
		last?: boolean;
		statuses?: Status[];
		/** tap marks with bar-local positions (16ths) */
		taps?: TapMark[];
		/** bar-local playhead position (16ths) */
		playhead?: number | null;
	}

	let { notes, first = false, last = false, statuses = [], taps = [], playhead = null }: Props =
		$props();

	const W = 300;
	const H = 110;
	const Y = 62; // staff line
	/** glyph scale (noteheads, stems, beams, rests); limited by 16th-note spacing */
	const S = 1.2;
	const STEM_X = 5.2 * S;
	const STEM_TOP = Y - 36 * S;
	const BEAM_H = 4.5 * S;
	const BEAM_GAP = 7 * S;
	const padL = $derived(first ? 40 : 14);
	const padR = 10;

	const xAt = (pos: number) => padL + (pos / SLOTS_PER_BAR) * (W - padL - padR);

	const COLORS: Record<string, string> = {
		perfect: 'var(--perfect)',
		good: 'var(--good)',
		miss: 'var(--miss)',
		extra: 'var(--extra)',
		live: 'var(--ink-soft)'
	};

	const layout = $derived.by(() => {
		const beams: { x1: number; x2: number; y: number }[] = [];
		const flags: { x: number; count: number }[] = [];

		for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
			const group = notes.filter((n) => !n.rest && Math.floor(n.start / SUBDIV) === beat);
			const sx = (n: Note) => xAt(n.start) + STEM_X;

			if (group.length === 1) {
				const n = group[0];
				const count = n.dur === 1 ? 2 : n.dur < 4 ? 1 : 0;
				if (count) flags.push({ x: sx(n), count });
				continue;
			}
			if (group.length < 2) continue;

			beams.push({ x1: sx(group[0]), x2: sx(group[group.length - 1]), y: STEM_TOP });

			// secondary (16th) beams
			for (let i = 0; i < group.length; i++) {
				const n = group[i];
				if (n.dur !== 1) continue;
				const next = group[i + 1];
				const prev = group[i - 1];
				if (next && next.dur === 1) {
					beams.push({ x1: sx(n), x2: sx(next), y: STEM_TOP + BEAM_GAP });
				} else if (!(prev && prev.dur === 1)) {
					const stub = 9 * S;
					if (i === group.length - 1) beams.push({ x1: sx(n) - stub, x2: sx(n), y: STEM_TOP + BEAM_GAP });
					else beams.push({ x1: sx(n), x2: sx(n) + stub, y: STEM_TOP + BEAM_GAP });
				}
			}
		}
		return { beams, flags };
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-label="bar">
	<!-- staff line and bar lines -->
	<line x1="0" x2={W} y1={Y} y2={Y} class="staff" />
	{#if first}
		<line x1="1" x2="1" y1={Y - 18} y2={Y + 18} class="barline" />
		<text x="20" y={Y - 3} class="timesig">4</text>
		<text x="20" y={Y + 19} class="timesig">4</text>
	{/if}
	{#if last}
		<line x1={W - 6} x2={W - 6} y1={Y - 18} y2={Y + 18} class="barline" />
		<line x1={W - 2} x2={W - 2} y1={Y - 18} y2={Y + 18} class="barline" stroke-width="4" />
	{:else}
		<line x1={W - 0.5} x2={W - 0.5} y1={Y - 18} y2={Y + 18} class="barline" />
	{/if}

	<!-- beat guides -->
	{#each [1, 2, 3] as b (b)}
		<line x1={xAt(b * SUBDIV) - 4} x2={xAt(b * SUBDIV) - 4} y1={Y + 22} y2={Y + 26} class="guide" />
	{/each}

	{#each notes as n (n.start)}
		{@const x = xAt(n.start)}
		{#if n.rest}
			{#if n.dur >= 4}
				<path
					transform="translate({x} {Y}) scale({S})"
					d="M -2 -14 L 3 -8 L -2 -2 L 3 4 Q -5 2 -1 10"
					class="rest"
				/>
			{:else}
				<g transform="translate({x} {Y}) scale({S})">
					<circle cx="-2" cy="-7" r="2.4" fill="var(--ink)" />
					<path d="M -2 -6 Q 1 -4 4 -9 L 0 7" class="rest thin" />
				</g>
			{/if}
		{:else}
			{@const color = statuses[n.index] ? COLORS[statuses[n.index]] : 'var(--ink)'}
			<ellipse cx={x} cy={Y} rx={6.2 * S} ry={4.4 * S} transform="rotate(-20 {x} {Y})" fill={color} />
			<line x1={x + STEM_X} x2={x + STEM_X} y1={Y - 1.5} y2={STEM_TOP} class="stem" />
			{#if n.dur === 3}
				<circle cx={x + 11 * S} cy={Y - 2 * S} r={1.8 * S} fill="var(--ink)" />
			{/if}
		{/if}
	{/each}

	{#each layout.beams as b, i (i)}
		<rect x={b.x1 - 0.8} y={b.y} width={b.x2 - b.x1 + 1.6} height={BEAM_H} fill="var(--ink)" />
	{/each}

	{#each layout.flags as f, i (i)}
		{#each Array(f.count) as _, k (k)}
			<path
				transform="translate({f.x} {STEM_TOP + k * BEAM_GAP}) scale({S})"
				d="M 0 0 c 1 5 9 8 7 17 c -1 -6 -4 -9 -7 -11 z"
				fill="var(--ink)"
			/>
		{/each}
	{/each}

	<!-- taps -->
	{#each taps as t, i (i)}
		{@const tx = xAt(t.pos)}
		<path d="M {tx} {Y + 30} l -4 7 h 8 z" fill={COLORS[t.kind]} />
	{/each}

	{#if playhead !== null}
		<line x1={xAt(playhead)} x2={xAt(playhead)} y1="10" y2={H - 4} class="playhead" />
	{/if}
</svg>

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
		overflow: visible;
	}
	.staff,
	.barline,
	.stem {
		stroke: var(--ink);
	}
	.staff {
		stroke-width: 1.2;
	}
	.barline {
		stroke-width: 1.4;
	}
	.stem {
		stroke-width: 1.8;
	}
	.guide {
		stroke: var(--line);
		stroke-width: 1;
	}
	.timesig {
		font: bold 22px Georgia, serif;
		fill: var(--ink);
		text-anchor: middle;
	}
	.rest {
		fill: none;
		stroke: var(--ink);
		stroke-width: 2.4;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.rest.thin {
		stroke-width: 1.5;
	}
	.playhead {
		stroke: var(--accent);
		stroke-width: 2;
	}
</style>
