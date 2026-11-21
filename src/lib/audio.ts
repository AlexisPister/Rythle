// Tiny Web Audio helpers: metronome clicks and percussive blips.

let _ctx: AudioContext | null = null;

export function getCtx(): AudioContext {
	return (_ctx ??= new AudioContext());
}

/** Seconds between when a sound is scheduled and when the user hears it. */
export function outputLatency(): number {
	const c = getCtx();
	return c.outputLatency || c.baseLatency || 0;
}

export type Stopper = () => void;

function blip(time: number, freq: number, dur: number, gain: number, type: OscillatorType): Stopper {
	const c = getCtx();
	const osc = c.createOscillator();
	const g = c.createGain();
	osc.type = type;
	osc.frequency.value = freq;
	g.gain.setValueAtTime(0.0001, time);
	g.gain.exponentialRampToValueAtTime(gain, time + 0.002);
	g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
	osc.connect(g).connect(c.destination);
	osc.start(time);
	osc.stop(time + dur + 0.02);
	return () => {
		try {
			osc.stop();
		} catch {
			/* already stopped */
		}
		g.disconnect();
	};
}

export const click = (time: number, accent: boolean, volume = 1) =>
	blip(time, accent ? 1600 : 1100, 0.04, (accent ? 0.5 : 0.3) * volume, 'sine');

/** Sound of a note: used both for the demo playback and for the user's taps. */
export const noteSound = (time: number) => blip(time, 440, 0.12, 0.5, 'triangle');
