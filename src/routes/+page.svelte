<script lang="ts">
	import { onMount } from 'svelte';
	import Bar, { barWidth, BAR_H } from '#lib/Bar.svelte';
	import {
		N_BARS,
		NB_ATTEMPTS,
		BEATS_PER_BAR,
		SLOTS_PER_BAR,
		generateRhythm,
		todayKey,
		puzzleNumber
	} from '#lib/rhythm.ts';
	import {
		scoreAttempt,
		emojiRow,
		PERFECT_SEC,
		GOOD_SEC,
		GOOD_WEIGHT,
		EXTRA_PENALTY,
		type Attempt,
		type TapMark
	} from '#lib/scoring.ts';
	import * as audio from '#lib/audio.ts';

	const MAX_ATTEMPTS = NB_ATTEMPTS;
	const dateKey = todayKey();
	const number = puzzleNumber(dateKey);
	const rhythm = generateRhythm(`rythle-${dateKey}`);
	const { bpm, beatSec, slotSec, totalSec } = rhythm;
	const storageKey = `rythle:${dateKey}`;

	let attempts = $state<Attempt[]>([]);
	let phase = $state<'idle' | 'demo' | 'countin' | 'playing'>('idle');
	let liveTaps = $state<number[]>([]); // seconds relative to the first downbeat
	let playPos = $state<number | null>(null); // global position in 16ths
	let countdown = $state<number | null>(null);
	let metronome = $state(true);
	let offsetMs = $state(0);
	let copied = $state(false);
	let settingsDialog: HTMLDialogElement;
	let demoPlayed = $state(false); // the rhythm is only played to the user once per day

	let demoStart = 0; // audio time of the demo's first downbeat
	let t0 = 0; // audio time of the user's first downbeat
	let withDemo = false;
	let listenOnly = false; // replaying the rhythm after the game is over
	let latency = 0;
	let raf = 0;
	let scheduled: audio.Stopper[] = [];

	const last = $derived(attempts.at(-1));
	const solved = $derived(attempts.some((a) => a.solved));
	const over = $derived(solved || attempts.length >= MAX_ATTEMPTS);
	const best = $derived(attempts.reduce((m, a) => Math.max(m, a.score), 0));

	const shownTaps: TapMark[] = $derived(
		phase !== 'idle'
			? liveTaps.map((t) => ({ pos: t / slotSec, kind: 'live' as const }))
			: (last?.taps ?? [])
	);

	// Bar widths (first/last bars have extra room) → grid columns and overall aspect ratio.
	const widths = rhythm.bars.map((_, i) => barWidth(i === 0, i === rhythm.bars.length - 1));
	const lineStyle = `grid-template-columns: ${widths.map((w) => `minmax(0, ${w}fr)`).join(' ')}; --aspect: ${widths.reduce((a, b) => a + b, 0) / BAR_H}`;

	// A bar's timed area covers local positions [-0.5, 15.5) (slots are centered in their cells);
	// the first and last bars also own anything before / after the rhythm.
	function inBar(bar: number, p: number, extra = 0): boolean {
		const lo = bar === 0 ? -0.5 - extra : -0.5;
		const hi = bar === rhythm.bars.length - 1 ? SLOTS_PER_BAR + 0.5 + extra : SLOTS_PER_BAR - 0.5;
		return p >= lo && p < hi;
	}

	function tapsForBar(bar: number): TapMark[] {
		return shownTaps
			.map((t) => ({ ...t, pos: t.pos - bar * SLOTS_PER_BAR }))
			.filter((t) => inBar(bar, t.pos, 0.5));
	}

	function playheadForBar(bar: number): number | null {
		if (playPos === null) return null;
		const p = playPos - bar * SLOTS_PER_BAR;
		return inBar(bar, p) ? p : null;
	}

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
			if (saved?.attempts) attempts = saved.attempts;
			if (saved?.demoPlayed) demoPlayed = true;
			const s = JSON.parse(localStorage.getItem('rythle:settings') ?? 'null');
			if (s) ({ metronome = true, offsetMs = 0 } = s);
		} catch {
			/* ignore corrupt storage */
		}
		return cancel;
	});

	$effect(() => {
		localStorage.setItem('rythle:settings', JSON.stringify({ metronome, offsetMs }));
	});

	/** @param listenFirst play the rhythm before the countdown (always done the first time) */
	async function start(listenFirst = false) {
		if (over || phase !== 'idle') return;
		const ctx = audio.getCtx();
		await ctx.resume();
		latency = audio.outputLatency() + offsetMs / 1000;
		// Timeline: [demo, first time only] → 4-beat "your turn" count-in → user plays.
		withDemo = !demoPlayed || listenFirst;
		listenOnly = false;
		demoStart = ctx.currentTime + 0.2;
		const countinStart = withDemo ? demoStart + totalSec : demoStart;
		t0 = countinStart + BEATS_PER_BAR * beatSec;
		scheduled = [];
		if (withDemo) {
			for (let b = 0; b < N_BARS * BEATS_PER_BAR; b++)
				scheduled.push(audio.click(demoStart + b * beatSec, b % BEATS_PER_BAR === 0, 0.5));
			for (const o of rhythm.onsets) scheduled.push(audio.noteSound(demoStart + o));
		}
		for (let i = 0; i < BEATS_PER_BAR; i++)
			scheduled.push(audio.click(countinStart + i * beatSec, i === 0));
		if (metronome) {
			for (let b = 0; b < N_BARS * BEATS_PER_BAR; b++)
				scheduled.push(audio.click(t0 + b * beatSec, b % BEATS_PER_BAR === 0, 0.5));
		}
		liveTaps = [];
		phase = withDemo ? 'demo' : 'countin';
		raf = requestAnimationFrame(tick);
	}

	function tick() {
		const now = audio.getCtx().currentTime - latency;
		const rel = now - t0;
		const demoRel = now - demoStart;
		if (listenOnly && demoRel >= totalSec) {
			cancelAnimationFrame(raf);
			return reset();
		}
		if (withDemo && demoRel < totalSec) {
			phase = 'demo';
			playPos = Math.max(0, demoRel / slotSec);
		} else if (rel < 0) {
			if (withDemo && !demoPlayed) {
				demoPlayed = true;
				save();
			}
			phase = 'countin';
			countdown = Math.min(BEATS_PER_BAR, Math.ceil(-rel / beatSec));
			playPos = null;
		} else {
			phase = 'playing';
			countdown = null;
			playPos = Math.min(rel / slotSec, N_BARS * SLOTS_PER_BAR - 0.001);
		}
		if (rel > totalSec + 0.25) finish();
		else raf = requestAnimationFrame(tick);
	}

	function finish() {
		cancelAnimationFrame(raf);
		const attempt = scoreAttempt(rhythm, liveTaps);
		attempts = [...attempts, attempt];
		save();
		reset();
	}

	function save() {
		localStorage.setItem(storageKey, JSON.stringify({ attempts, demoPlayed }));
	}

	function cancel() {
		cancelAnimationFrame(raf);
		scheduled.forEach((stop) => stop());
		reset();
	}

	function reset() {
		phase = 'idle';
		playPos = null;
		countdown = null;
		liveTaps = [];
	}

	function tap() {
		if (phase === 'idle') return start();
		if (phase === 'demo') return; // just listen during the demo
		liveTaps.push(audio.getCtx().currentTime - latency - t0);
		audio.noteSound(audio.getCtx().currentTime);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || settingsDialog?.open) return;
		if ((e.target as HTMLElement)?.closest('input, summary, button:not(.pad)')) {
			if (e.code !== 'Space' || phase === 'idle') return;
		}
		if (e.key === 'Escape') return cancel();
		if (phase === 'idle' && attempts.length && e.key.toLowerCase() === 'l') return void start(true);
		if (e.code === 'Space' || e.key.length === 1) {
			e.preventDefault();
			tap();
		}
	}

	/** Replay the rhythm (after the game is over), with the playhead; can't overlap itself. */
	async function listen() {
		if (phase !== 'idle') return;
		const ctx = audio.getCtx();
		await ctx.resume();
		latency = audio.outputLatency() + offsetMs / 1000;
		withDemo = true;
		listenOnly = true;
		demoStart = ctx.currentTime + 0.2;
		t0 = demoStart + totalSec;
		scheduled = [];
		for (let b = 0; b < N_BARS * BEATS_PER_BAR; b++)
			scheduled.push(audio.click(demoStart + b * beatSec, b % BEATS_PER_BAR === 0, 0.4));
		for (const o of rhythm.onsets) scheduled.push(audio.noteSound(demoStart + o));
		phase = 'demo';
		raf = requestAnimationFrame(tick);
	}

	async function share() {
		// Only the best attempt is shared (a solved one wins), plus how many attempts were used.
		const rank = (a: Attempt) => (a.solved ? 1000 : 0) + a.score;
		const top = attempts.reduce((b, a) => (rank(a) > rank(b) ? a : b));
		const head = `Rythle #${number} · ♩=${bpm} · ${top.score}% · ${attempts.length}/${MAX_ATTEMPTS} attempts`;
		const text = `${head}\n${emojiRow(top, rhythm)}`;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<main>
	<header>
		<h1>Rythle</h1>
		<p class="sub">#{number} · {dateKey} · ♩ = {bpm}</p>
	</header>

	<section class="sheet">
		<div class="line" style={lineStyle}>
		{#each rhythm.bars as notes, i (i)}
			<Bar
				{notes}
				first={i === 0}
				last={i === rhythm.bars.length - 1}
				statuses={phase === 'idle' ? last?.statuses : []}
				taps={tapsForBar(i)}
				playhead={playheadForBar(i)}
			/>
		{/each}
		</div>
	</section>

	{#if phase === 'idle' && attempts.length && !over}
		<div class="retry">
			<button
				class="pad"
				onpointerdown={(e) => {
					e.preventDefault();
					start(true);
				}}
			>
				Listen &amp; try again
				<small>attempt {attempts.length + 1} / {MAX_ATTEMPTS} · <kbd>L</kbd></small>
			</button>
			<button
				class="pad"
				onpointerdown={(e) => {
					e.preventDefault();
					start();
				}}
			>
				Try again
				<small>attempt {attempts.length + 1} / {MAX_ATTEMPTS} · <kbd>Space</kbd></small>
			</button>
		</div>
	{:else}
	<button
		class="pad"
		class:active={phase !== 'idle'}
		disabled={over && phase === 'idle'}
		onpointerdown={(e) => {
			e.preventDefault();
			tap();
		}}
	>
		{#if phase === 'demo'}
			<span class="big">Listen…</span>
		{:else if phase === 'countin'}
			Your turn
			<span class="big">{countdown}</span>
		{:else if phase === 'playing'}
			<span class="big">Tap</span>
		{:else if over}
			{solved ? 'Solved!' : 'Out of attempts'}
		{:else}
			Start
			<small>attempt 1 / {MAX_ATTEMPTS}</small>
		{/if}
	</button>
	{/if}
	<p class="hint">
		{#if phase === 'idle'}
			{#if over}
				Come back tomorrow for a new rhythm.
			{:else if attempts.length}
				Hear the rhythm again first, or go straight to the countdown. Then tap each note (press any
				key or click the button).
			{:else}
				Press <kbd>Space</kbd> or the pad. Listen to the rhythm once, then after the countdown tap
				each note (press any key or click the button).
			{/if}
		{:else if phase === 'demo'}
			Listen to the rhythm · <kbd>Esc</kbd> to cancel
		{:else}
			Tap with <kbd>Space</kbd> (any key) or the pad · <kbd>Esc</kbd> to cancel
		{/if}
	</p>

	{#if last && phase === 'idle'}
		<section class="result">
			<span class="score">{last.score}%</span>
			<button type="button" class="help" aria-label="How the score is computed">
				?
				<span class="tooltip">
					Each note is worth <b>1 point</b> if tapped within ±{PERFECT_SEC * 1000} ms
					<span class="perfect">(perfect)</span>, <b>{GOOD_WEIGHT} points</b> within ±{GOOD_SEC *
						1000} ms <span class="good">(close)</span>, and 0 if missed.<br />
					Score = points ÷ number of notes × 100, minus <b>{EXTRA_PENALTY}%</b> per extra tap (never
					below 0).<br />
					The puzzle is solved when every note is hit with no extra taps.
				</span>
			</button>
			{#if attempts.length > 1}<span class="best">best {best}%</span>{/if}
			<span class="perfect">● {last.statuses.filter((st) => st === 'perfect').length} perfect</span>
			<span class="good">● {last.statuses.filter((st) => st === 'good').length} close</span>
			<span class="miss">● {last.statuses.filter((st) => st === 'miss').length} missed</span>
			<span class="extra">▲ {last.extras} extra</span>
		</section>
	{/if}

	{#if attempts.length}
		<ol class="history">
			{#each attempts as a, i (i)}
				<li><span>{emojiRow(a, rhythm)}</span> <b>{a.score}%</b></li>
			{/each}
		</ol>
	{/if}

	<div class="actions">
		{#if attempts.length}
			<button onclick={share} disabled={phase !== 'idle'}>{copied ? 'Copied!' : 'Share'}</button>
		{/if}
		{#if over}
			<button onclick={listen} disabled={phase !== 'idle'}>
				{phase === 'demo' ? 'Listening…' : 'Listen'}
			</button>
		{/if}
		<button onclick={() => settingsDialog.showModal()} disabled={phase !== 'idle'}>Settings</button>
	</div>

	<dialog bind:this={settingsDialog} closedby="any">
		<h2>Settings</h2>
		<label><input type="checkbox" bind:checked={metronome} /> Metronome while playing</label>
		<label>
			Latency offset
			<input type="number" step="5" bind:value={offsetMs} style="width: 5em" /> ms
		</label>
		<p class="note">Increase the offset if your taps are consistently marked late.</p>
		<form method="dialog"><button>Close</button></form>
	</dialog>
</main>

<style>
	:global(:root) {
		--ink: #1d1d1f;
		--ink-soft: #8a8a8e;
		--line: #c8c8cc;
		--bg: #fafaf7;
		--accent: #4361ee;
		--perfect: #2a9d55;
		--good: #e0a100;
		--miss: #b8b8bc;
		--extra: #d64545;
	}
	:global(body) {
		margin: 0;
		overflow-x: hidden;
		background: var(--bg);
		color: var(--ink);
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
	}
	/* Everything fits in one screen: no scrolling. */
	main {
		max-width: 1200px;
		height: 100dvh;
		box-sizing: border-box;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(0.4rem, 2vh, 1.1rem);
	}
	header {
		text-align: center;
	}
	h1 {
		margin: 0;
		font-size: 52px;
		line-height: 1;
		letter-spacing: 0.08em;
	}
	.sub {
		margin: 0.25rem 0 0;
		color: var(--ink-soft);
	}
	.sheet {
		/* break out of the page column to use the full window width */
		width: calc(100vw - 2rem);
		height: 25vh;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		container-type: size;
		padding: 0.75rem 1rem;
		box-sizing: border-box;
		background: white;
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	/* All bars on one line, as large as the sheet allows (bar SVG aspect is 300x110). */
	.line {
		display: grid;
		/* columns are set inline, proportional to each bar's width */
		width: min(100cqw, 100cqh * var(--aspect));
	}
	.retry {
		display: flex;
		gap: 1rem;
	}
	.retry .pad {
		width: min(220px, 44vw);
	}
	.pad {
		width: 220px;
		height: clamp(64px, 14vh, 120px);
		flex-shrink: 0;
		border-radius: 14px;
		border: 2px solid var(--ink);
		background: white;
		font-size: 1.2rem;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		touch-action: manipulation;
		user-select: none;
	}
	.pad small {
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
	.pad.active {
		background: var(--ink);
		color: white;
	}
	.pad:active {
		transform: scale(0.98);
	}
	.pad:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.big {
		font-size: 2.2rem;
		font-weight: 700;
	}
	.hint {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.9rem;
		text-align: center;
	}
	kbd {
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 4px;
		font-size: 0.85em;
	}
	.result {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
		font-size: 0.9rem;
	}
	.score {
		font-size: 1.8rem;
		font-weight: 700;
	}
	.best {
		color: var(--ink-soft);
	}
	.help {
		position: relative;
		align-self: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		border: 1px solid var(--ink-soft);
		color: var(--ink-soft);
		font-size: 0.8rem;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: help;
		background: none;
		padding: 0;
	}
	.tooltip {
		display: none;
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		width: 280px;
		padding: 0.6rem 0.8rem;
		background: var(--ink);
		color: white;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 400;
		line-height: 1.45;
		text-align: left;
		z-index: 10;
	}
	.help:hover .tooltip,
	.help:focus .tooltip {
		display: block;
	}
	.perfect {
		color: var(--perfect);
	}
	.good {
		color: var(--good);
	}
	.miss {
		color: var(--ink-soft);
	}
	.extra {
		color: var(--extra);
	}
	.history {
		margin: 0;
		padding-left: 1.5rem;
		font-size: 0.95rem;
	}
	.history li {
		margin: 0.1rem 0;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
	.actions button,
	dialog button {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--ink);
		background: white;
		cursor: pointer;
		font-size: 0.95rem;
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	dialog {
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		min-width: 260px;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.3);
	}
	dialog h2 {
		margin: 0 0 0.75rem;
		font-size: 1.2rem;
	}
	dialog label {
		display: block;
		margin: 0.5rem 0;
	}
	dialog .note {
		color: var(--ink-soft);
		font-size: 0.85rem;
	}
	dialog form {
		text-align: right;
	}
</style>
